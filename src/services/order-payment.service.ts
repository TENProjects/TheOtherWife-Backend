/** @format */

import mongoose, { ClientSession } from "mongoose";
import Order, { type OrderDocument } from "../models/order.model.js";
import Payment, { type PaymentDocument } from "../models/payment.model.js";
import Cart from "../models/cart.model.js";
import PromoCode from "../models/promoCode.model.js";
import Vendor from "../models/vendor.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import {
  orderPaymentMaxAgeHours,
  orderPaymentTtlMinutes,
  paystackBaseUrl,
  paystackSecretKey,
} from "../constants/env.js";
import { transaction } from "../util/transaction.util.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import {
  isCustomerVisibleOrder,
  UNPAID_CANCELLATION_REASON,
} from "../util/order-visibility.util.js";
import { WalletService } from "./wallet.service.js";
import { PromoService } from "./promo.service.js";
import { VendorWalletService } from "./vendor-wallet.service.js";
import { PaymentLedgerService } from "./payment-ledger.service.js";
import { RefundService } from "./refund.service.js";
import { getPickupLocationForOrder } from "./order-pickup.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Order payment lifecycle.
//
// An Order is created as "pending_payment" before the customer pays (the
// Paystack reference must exist first). From there it can only move:
//   pending_payment → paid                       (payment confirmed)
//   pending_payment → cancelled/payment_timeout  (failed, expired, abandoned,
//                                                 superseded or cancelled)
// Every transition is an atomic findOneAndUpdate guarded on
// status: "pending_payment", so the webhook, the expiry job, the customer's
// verify/cancel calls and a new checkout can race safely: exactly one wins.
// A payment that lands after its checkout was closed is never resurrected
// into a vendor-facing order — it is refunded (see confirmOrderPayment).
// ─────────────────────────────────────────────────────────────────────────────

export type PaystackTransactionData = {
  id?: number | string;
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  paid_at?: string | null;
  [key: string]: unknown;
};

export type PaystackVerification =
  | { outcome: "success"; data: PaystackTransactionData }
  | { outcome: "failed" | "abandoned" | "pending"; status: string }
  | { outcome: "not_found" }
  | { outcome: "error"; reason: string };

export type UnpaidCheckoutAction = "confirm" | "expire" | "keep";

// Pure decision used by the expiry job (and unit-tested): given how old an
// unpaid checkout is and what Paystack says, what should happen to it?
export const decideUnpaidCheckoutAction = (params: {
  ageMs: number;
  ttlMs: number;
  maxAgeMs: number;
  // null when there is nothing to verify with Paystack (wallet/zero amount).
  verification: PaystackVerification | null;
}): UnpaidCheckoutAction => {
  const { ageMs, ttlMs, maxAgeMs, verification } = params;
  if (verification?.outcome === "success") return "confirm";
  if (ageMs >= maxAgeMs) return "expire";
  if (ageMs < ttlMs) return "keep";
  if (verification === null) return "expire";
  switch (verification.outcome) {
    case "failed":
    case "abandoned":
    case "not_found":
      return "expire";
    // Still in flight at Paystack (e.g. a bank transfer), or Paystack could
    // not be reached: wait — the hard max-age above eventually closes it.
    case "pending":
    case "error":
    default:
      return "keep";
  }
};

const MINUTE_MS = 60 * 1000;
// A customer's verify-payment polling must not turn into a Paystack API
// hammer: verify a given order with Paystack at most once per this window.
const VERIFY_COOLDOWN_MS = 3000;
const PAYSTACK_TIMEOUT_MS = 10_000;

const notFound = (what = "Order") =>
  new NotFoundException(`${what} not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);
const conflict = (message: string) =>
  new BadRequestException(message, HttpStatus.CONFLICT, ErrorCode.RESOURCE_CONFLICT);

type Actor = "webhook" | "system" | "customer";

type ConfirmResult =
  | { outcome: "paid"; order: OrderDocument }
  | { outcome: "late_refund"; order: OrderDocument; refundAmount: number }
  | { outcome: "already_recorded"; order: null };

export class OrderPaymentService {
  private walletService = new WalletService();
  private promoService = new PromoService();
  private vendorWalletService = new VendorWalletService();
  private paymentLedgerService = new PaymentLedgerService();
  private refundService = new RefundService();
  private lastVerifiedAt = new Map<string, number>();

  get paymentTtlMs() {
    return orderPaymentTtlMinutes * MINUTE_MS;
  }

  get paymentMaxAgeMs() {
    return orderPaymentMaxAgeHours * 60 * MINUTE_MS;
  }

  // ── Paystack ──────────────────────────────────────────────────────────────

  // Server-to-server source of truth for a transaction. Never trusts what a
  // client says about a payment; validates that the reference, amount (kobo)
  // and currency match what we asked Paystack to charge.
  verifyPaystackTransaction = async (
    payment: Pick<PaymentDocument, "reference" | "amount" | "currency">,
  ): Promise<PaystackVerification> => {
    if (!paystackSecretKey) return { outcome: "error", reason: "paystack_not_configured" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAYSTACK_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${paystackBaseUrl}/transaction/verify/${encodeURIComponent(payment.reference)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${paystackSecretKey}` },
          signal: controller.signal,
        },
      );
      const body = (await response.json().catch(() => null)) as {
        status?: boolean;
        message?: string;
        data?: PaystackTransactionData;
      } | null;

      if (!response.ok || !body?.status || !body.data) {
        if (/not found/i.test(body?.message ?? "")) return { outcome: "not_found" };
        return { outcome: "error", reason: `paystack_http_${response.status}` };
      }

      const data = body.data;
      if (data.reference !== payment.reference) {
        return { outcome: "error", reason: "reference_mismatch" };
      }

      const status = String(data.status ?? "");
      if (status === "success") {
        const expectedKobo = Math.round(payment.amount * 100);
        const amountMatches = Math.round(Number(data.amount)) === expectedKobo;
        const currencyMatches = !data.currency || data.currency === payment.currency;
        if (!amountMatches || !currencyMatches) {
          return { outcome: "error", reason: "amount_or_currency_mismatch" };
        }
        return { outcome: "success", data };
      }
      if (status === "failed" || status === "reversed") return { outcome: "failed", status };
      if (status === "abandoned") return { outcome: "abandoned", status };
      return { outcome: "pending", status };
    } catch (error: any) {
      return { outcome: "error", reason: error?.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  };

  // ── Payment confirmed ─────────────────────────────────────────────────────

  // Single success path for an order payment, shared by the Paystack webhook,
  // reconciliation (expiry job / verify-payment) and checkout supersession.
  // Idempotent: a payment already recorded as succeeded is a no-op.
  confirmOrderPayment = async (
    paymentId: string,
    providerPayload: PaystackTransactionData,
    actor: Actor,
    paystackEvent?: string,
  ): Promise<ConfirmResult> => {
    const result = await transaction.use(
      async (session: ClientSession, currentPaymentId: string): Promise<ConfirmResult> => {
        const paymentRecord = await Payment.findById(currentPaymentId).session(session);
        if (!paymentRecord) throw notFound("Payment");

        if (paymentRecord.status === "succeeded" || paymentRecord.status === "refunded") {
          return { outcome: "already_recorded", order: null };
        }

        const paidKobo = Math.round(Number(providerPayload?.amount));
        if (!Number.isFinite(paidKobo) || paidKobo !== Math.round(paymentRecord.amount * 100)) {
          throw new BadRequestException(
            "Payment amount mismatch",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const previousStatus = paymentRecord.status;
        const paidAt = providerPayload?.paid_at ? new Date(providerPayload.paid_at) : new Date();
        paymentRecord.status = "succeeded";
        paymentRecord.providerTransactionId = String(providerPayload?.id ?? "");
        paymentRecord.providerPayload = providerPayload;
        paymentRecord.paidAt = paidAt;
        await paymentRecord.save({ session });

        const order = await Order.findOneAndUpdate(
          { _id: paymentRecord.orderId, status: "pending_payment" },
          { $set: { status: "paid", paymentStatus: "paid", paidAt } },
          { session, new: true },
        );

        if (order) {
          await this.walletService.finalizeReservedWalletForOrder(
            session,
            paymentRecord.customerId.toString(),
            order._id.toString(),
          );

          try {
            await this.promoService.creditEligiblePaidOrder(session, order);
          } catch (error: any) {
            console.error("Skipping promo credit after payment confirmation", {
              orderId: order._id?.toString?.(),
              message: error?.message,
            });
          }

          await Cart.findOneAndUpdate(
            { customerId: paymentRecord.customerId },
            { $set: { meals: [], totalAmount: 0 } },
            { session },
          );

          const syncedPayment = await this.vendorWalletService.syncPaymentSettlementFromOrder(
            session,
            paymentRecord._id.toString(),
          );

          await this.paymentLedgerService.record(session, {
            payment: syncedPayment,
            entryType: "payment_succeeded",
            amount: paidKobo / 100,
            previousStatus,
            actorType: actor,
            metadata: {
              paystackEvent: paystackEvent ?? null,
              reference: paymentRecord.reference,
              reconciled: actor !== "webhook",
            },
          });

          await this.settleSplitIfAny(session, syncedPayment);

          return { outcome: "paid", order };
        }

        // The checkout was no longer awaiting payment.
        const current = await Order.findById(paymentRecord.orderId).session(session);
        if (!current) throw notFound();

        if (
          current.status === "cancelled" &&
          current.cancellationReason === UNPAID_CANCELLATION_REASON
        ) {
          // Late payment: money arrived after the checkout was closed. The
          // order stays cancelled (no vendor ever saw it); record the money,
          // claw back any instant vendor split, and open a refund for exactly
          // what was charged through Paystack (any wallet portion was already
          // released back to the customer when the checkout closed).
          current.paymentStatus = "paid";
          current.paidAt = paidAt;
          await current.save({ session });

          const syncedPayment = await this.vendorWalletService.syncPaymentSettlementFromOrder(
            session,
            paymentRecord._id.toString(),
          );

          await this.paymentLedgerService.record(session, {
            payment: syncedPayment,
            entryType: "payment_succeeded",
            amount: paidKobo / 100,
            previousStatus,
            actorType: actor,
            metadata: {
              paystackEvent: paystackEvent ?? null,
              reference: paymentRecord.reference,
              lateAfterExpiry: true,
            },
          });

          await this.settleSplitIfAny(session, syncedPayment);

          const refundAmount = paidKobo / 100;
          await this.refundService.openCancellationRefund(session, {
            orderId: current._id.toString(),
            customerId: current.customerId.toString(),
            vendorId: current.vendorId.toString(),
            amount: refundAmount,
            reason: "Payment received after the checkout had expired",
          });

          return { outcome: "late_refund", order: current, refundAmount };
        }

        // Any other state means this payment no longer matches its order —
        // abort the whole transaction rather than guess.
        throw conflict("This order is not awaiting payment");
      },
    )(paymentId);

    if (result.outcome === "paid") {
      const order = result.order;
      await appSignalDispatcher.emit("order.status_changed", {
        orderId: order._id.toString(),
        customerUserId: order.customerId.toString(),
        vendorId: order.vendorId.toString(),
        previousStatus: "pending_payment",
        currentStatus: "paid",
      });
      await appSignalDispatcher.emit("order.paid", {
        orderId: order._id.toString(),
        customerUserId: order.customerId.toString(),
        vendorId: order.vendorId.toString(),
        totalAmount: order.totalAmount,
        currency: order.currency,
      });
    } else if (result.outcome === "late_refund") {
      await appSignalDispatcher.emit("order.payment_received_after_expiry", {
        orderId: result.order._id.toString(),
        customerUserId: result.order.customerId.toString(),
        amount: result.refundAmount,
        currency: result.order.currency,
      });
    }

    return result;
  };

  // Section 3.2 — when the charge was split, Paystack already deposited the
  // vendor's 80% straight to their bank at charge time. Mark it settled so it
  // never shows as "available to withdraw".
  private settleSplitIfAny = async (session: ClientSession, payment: PaymentDocument) => {
    if (!payment.splitPayment) return;
    payment.vendorSettledAmount = payment.vendorNetAmount;
    payment.settlementStatus = "paid";
    await payment.save({ session });

    await this.paymentLedgerService.record(session, {
      payment,
      entryType: "vendor_split_settled",
      amount: payment.vendorNetAmount,
      actorType: "webhook",
      metadata: { reason: "paystack_subaccount_split" },
    });
  };

  // ── Payment failed (Paystack charge.failed) ──────────────────────────────

  failOrderPayment = async (paymentId: string, providerPayload: PaystackTransactionData) => {
    const result = await transaction.use(
      async (session: ClientSession, currentPaymentId: string) => {
        const paymentRecord = await Payment.findById(currentPaymentId).session(session);
        if (!paymentRecord) throw notFound("Payment");

        if (paymentRecord.status === "succeeded" || paymentRecord.status === "refunded") {
          return { order: null as OrderDocument | null };
        }

        const previousStatus = paymentRecord.status;
        paymentRecord.status = "failed";
        paymentRecord.providerPayload = providerPayload;
        await paymentRecord.save({ session });

        const order = await Order.findOneAndUpdate(
          { _id: paymentRecord.orderId, status: "pending_payment" },
          {
            $set: {
              status: "cancelled",
              cancellationReason: UNPAID_CANCELLATION_REASON,
              paymentStatus: "failed",
            },
          },
          { session, new: true },
        );

        if (order) {
          await this.walletService.releaseReservedWalletForOrder(
            session,
            paymentRecord.customerId.toString(),
            order._id.toString(),
          );
          await this.releasePromoRedemption(session, order);
        }

        const syncedPayment = await this.vendorWalletService.syncPaymentSettlementFromOrder(
          session,
          paymentRecord._id.toString(),
        );

        await this.paymentLedgerService.record(session, {
          payment: syncedPayment,
          entryType: "payment_failed",
          amount: 0,
          previousStatus,
          actorType: "webhook",
          metadata: { paystackEvent: "charge.failed" },
        });

        return { order };
      },
    )(paymentId);

    if (result.order) {
      await appSignalDispatcher.emit("order.status_changed", {
        orderId: result.order._id.toString(),
        customerUserId: result.order.customerId.toString(),
        vendorId: result.order.vendorId.toString(),
        previousStatus: "pending_payment",
        currentStatus: "cancelled",
      });
    }

    return { handled: true, order: result.order };
  };

  // ── Unpaid checkout closed (expired / abandoned / superseded) ────────────

  // Closes an unpaid checkout and hands back everything it was holding: the
  // reserved wallet funds and the promo redemption. Silent — the vendor never
  // knew about it, and the customer chose not to pay. Returns expired:false
  // if the order was no longer awaiting payment (someone else won the race).
  expireUnpaidOrder = async (
    orderId: string,
    options: {
      actor: "system" | "customer";
      actorUserId?: string;
      reason: "expired" | "customer_cancelled" | "superseded";
      verification?: string;
    },
  ) =>
    transaction.use(async (session: ClientSession, currentOrderId: string) => {
      const order = await Order.findOneAndUpdate(
        { _id: currentOrderId, status: "pending_payment" },
        {
          $set: {
            status: "cancelled",
            cancellationReason: UNPAID_CANCELLATION_REASON,
            paymentStatus: "failed",
          },
        },
        { session, new: true },
      );
      if (!order) return { expired: false as const, order: null };

      const payment = await Payment.findOne({ orderId: order._id }).session(session);
      if (payment && payment.status !== "succeeded" && payment.status !== "refunded") {
        const previousStatus = payment.status;
        payment.status = "expired";
        await payment.save({ session });

        const syncedPayment = await this.vendorWalletService.syncPaymentSettlementFromOrder(
          session,
          payment._id.toString(),
        );

        await this.paymentLedgerService.record(session, {
          payment: syncedPayment,
          entryType: "payment_cancelled",
          amount: 0,
          previousStatus,
          actorType: options.actor,
          actorId: options.actorUserId,
          metadata: {
            reason: options.reason,
            paystackVerification: options.verification ?? null,
          },
        });
      }

      await this.walletService.releaseReservedWalletForOrder(
        session,
        order.customerId.toString(),
        order._id.toString(),
      );
      await this.releasePromoRedemption(session, order);

      return { expired: true as const, order };
    })(orderId);

  // The promo's usedCount was incremented when the checkout was confirmed;
  // an unpaid checkout must not keep consuming a limited-use code.
  releasePromoRedemption = async (session: ClientSession, order: OrderDocument) => {
    if (!order.promoCodeId) return;
    await PromoCode.updateOne(
      { _id: order.promoCodeId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      { session },
    );
  };

  // ── Reconcile one unpaid checkout ────────────────────────────────────────

  private needsPaystackVerification = (payment: PaymentDocument | null) =>
    !!payment &&
    payment.provider === "paystack" &&
    payment.amount > 0 &&
    !!payment.reference &&
    payment.status !== "succeeded" &&
    payment.status !== "refunded";

  private verificationLabel = (verification: PaystackVerification | null) =>
    verification === null
      ? "not_required"
      : verification.outcome === "error"
        ? `error:${verification.reason}`
        : verification.outcome === "success" || verification.outcome === "not_found"
          ? verification.outcome
          : `${verification.outcome}:${verification.status}`;

  // ── Scheduled job ────────────────────────────────────────────────────────

  expireStaleUnpaidOrders = async (options: { dryRun?: boolean; limit?: number } = {}) => {
    const dryRun = options.dryRun === true;
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
    const now = Date.now();
    const ttlMs = this.paymentTtlMs;
    const maxAgeMs = this.paymentMaxAgeMs;

    const candidates = await Order.find({
      status: "pending_payment",
      createdAt: { $lt: new Date(now - ttlMs) },
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .select("_id customerId createdAt");

    const summary = {
      dryRun,
      ttlMinutes: orderPaymentTtlMinutes,
      maxAgeHours: orderPaymentMaxAgeHours,
      scanned: candidates.length,
      confirmed: 0,
      expired: 0,
      kept: 0,
      failed: 0,
      items: [] as Array<{
        orderId: string;
        ageMinutes: number;
        verification: string;
        action: UnpaidCheckoutAction;
        result?: string;
      }>,
    };

    // Sequential on purpose: bounded load on Paystack and on the database.
    for (const candidate of candidates) {
      const orderId = candidate._id.toString();
      const ageMs = now - new Date(candidate.get("createdAt")).getTime();
      try {
        const payment = await Payment.findOne({ orderId: candidate._id });
        const verification = this.needsPaystackVerification(payment)
          ? await this.verifyPaystackTransaction(payment as PaymentDocument)
          : null;
        const action = decideUnpaidCheckoutAction({ ageMs, ttlMs, maxAgeMs, verification });
        const item = {
          orderId,
          ageMinutes: Math.round(ageMs / MINUTE_MS),
          verification: this.verificationLabel(verification),
          action,
        } as (typeof summary.items)[number];

        if (!dryRun) {
          if (action === "confirm" && verification?.outcome === "success" && payment) {
            const confirmed = await this.confirmOrderPayment(
              payment._id.toString(),
              verification.data,
              "system",
              "reconciliation",
            );
            item.result = confirmed.outcome;
            if (confirmed.outcome !== "already_recorded") summary.confirmed += 1;
          } else if (action === "expire") {
            const expired = await this.expireUnpaidOrder(orderId, {
              actor: "system",
              reason: "expired",
              verification: item.verification,
            });
            item.result = expired.expired ? "expired" : "no_longer_pending";
            if (expired.expired) summary.expired += 1;
          } else {
            summary.kept += 1;
          }
        } else if (action === "keep") {
          summary.kept += 1;
        }

        summary.items.push(item);
      } catch (error: any) {
        summary.failed += 1;
        summary.items.push({
          orderId,
          ageMinutes: Math.round(ageMs / MINUTE_MS),
          verification: "unknown",
          action: "keep",
          result: `error:${error?.message ?? "unknown"}`,
        });
        console.error("Unpaid checkout expiry failed", { orderId, message: error?.message });
      }
    }

    return summary;
  };

  // ── Checkout supersession (called at the start of a new checkout) ────────

  // A customer starting a new checkout closes their previous unpaid ones, so
  // there is never more than one open checkout per customer and an abandoned
  // wallet reservation can't block the new one. If one of them turns out to
  // have been paid after all, the new checkout is refused so the customer
  // isn't charged twice.
  supersedePendingCheckouts = async (customerId: string) => {
    const pending = await Order.find({ customerId, status: "pending_payment" })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("_id");

    for (const pendingOrder of pending) {
      const orderId = pendingOrder._id.toString();
      const payment = await Payment.findOne({ orderId: pendingOrder._id });
      const verification = this.needsPaystackVerification(payment)
        ? await this.verifyPaystackTransaction(payment as PaymentDocument)
        : null;

      if (verification?.outcome === "success" && payment) {
        await this.confirmOrderPayment(
          payment._id.toString(),
          verification.data,
          "system",
          "reconciliation",
        );
        throw conflict(
          `Your earlier payment for order #${orderId.slice(-6)} went through. Check your orders before paying again.`,
        );
      }

      await this.expireUnpaidOrder(orderId, {
        actor: "customer",
        actorUserId: customerId,
        reason: "superseded",
        verification: this.verificationLabel(verification),
      });
    }
  };

  // ── Customer endpoints ───────────────────────────────────────────────────

  private findCustomerOrder = async (customerId: string, orderId: string) => {
    if (!mongoose.isValidObjectId(orderId)) throw notFound();
    const order = await Order.findOne({ _id: orderId, customerId });
    if (!order) throw notFound();
    return order;
  };

  // Server-authoritative payment state for the app's post-Paystack screen.
  // While the checkout is unpaid, this asks Paystack directly (rate-limited
  // per order) and records a success immediately rather than waiting for the
  // webhook.
  getCheckoutPaymentState = async (customerId: string, orderId: string) => {
    let order = await this.findCustomerOrder(customerId, orderId);

    if (order.status === "pending_payment") {
      const payment = await Payment.findOne({ orderId: order._id });
      const lastAt = this.lastVerifiedAt.get(orderId) ?? 0;
      if (this.needsPaystackVerification(payment) && Date.now() - lastAt >= VERIFY_COOLDOWN_MS) {
        this.lastVerifiedAt.set(orderId, Date.now());
        this.pruneVerifyCache();
        const verification = await this.verifyPaystackTransaction(payment as PaymentDocument);
        if (verification.outcome === "success" && payment) {
          await this.confirmOrderPayment(
            payment._id.toString(),
            verification.data,
            "system",
            "verify_payment",
          );
          order = await this.findCustomerOrder(customerId, orderId);
        }
      }
    }

    return this.describePaymentState(order);
  };

  // The customer closed the payment page / tapped "Cancel order". Re-checks
  // Paystack first so a payment that actually went through is never cancelled.
  cancelCustomerCheckout = async (customerId: string, orderId: string) => {
    const order = await this.findCustomerOrder(customerId, orderId);

    if (order.status !== "pending_payment") {
      if (order.status === "cancelled") return this.describePaymentState(order);
      throw conflict("This order has already been paid and can't be cancelled here");
    }

    const payment = await Payment.findOne({ orderId: order._id });
    const verification = this.needsPaystackVerification(payment)
      ? await this.verifyPaystackTransaction(payment as PaymentDocument)
      : null;

    if (verification?.outcome === "success" && payment) {
      await this.confirmOrderPayment(
        payment._id.toString(),
        verification.data,
        "system",
        "customer_cancel_check",
      );
    } else {
      await this.expireUnpaidOrder(orderId, {
        actor: "customer",
        actorUserId: customerId,
        reason: "customer_cancelled",
        verification: this.verificationLabel(verification),
      });
    }

    return this.describePaymentState(await this.findCustomerOrder(customerId, orderId));
  };

  private describePaymentState = async (order: OrderDocument) => {
    const isPending = order.status === "pending_payment";
    const paidButClosed =
      order.status === "cancelled" &&
      order.cancellationReason === UNPAID_CANCELLATION_REASON &&
      isCustomerVisibleOrder(order);

    let paymentState: "pending" | "paid" | "failed" | "refund_pending";
    if (isPending) paymentState = "pending";
    else if (paidButClosed) paymentState = "refund_pending";
    else if (isCustomerVisibleOrder(order)) paymentState = "paid";
    else paymentState = "failed";

    const [payment, vendor, pickupLocation] = await Promise.all([
      isPending
        ? Payment.findOne({ orderId: order._id }).select("authorizationUrl status")
        : Promise.resolve(null),
      Vendor.findById(order.vendorId).select("businessName businessLogoUrl").lean<{
        businessName?: string;
        businessLogoUrl?: string;
      }>(),
      getPickupLocationForOrder(order),
    ]);

    const createdAt = new Date(order.get("createdAt"));
    return {
      orderId: order._id.toString(),
      paymentState,
      status: order.status,
      paymentStatus: order.paymentStatus,
      cancellationReason: order.cancellationReason ?? null,
      fulfillmentType: order.fulfillmentType ?? "delivery",
      totalAmount: order.totalAmount,
      currency: order.currency,
      paidAt: order.paidAt ?? null,
      // Only while the checkout is still open — lets the app reopen the same
      // Paystack page instead of creating a new order.
      authorizationUrl: isPending ? (payment?.authorizationUrl ?? null) : null,
      expiresAt: isPending ? new Date(createdAt.getTime() + this.paymentTtlMs) : null,
      vendor: vendor
        ? { businessName: vendor.businessName ?? null, businessLogoUrl: vendor.businessLogoUrl ?? null }
        : null,
      pickupLocation,
    };
  };

  private pruneVerifyCache = () => {
    if (this.lastVerifiedAt.size < 1000) return;
    const cutoff = Date.now() - 10 * MINUTE_MS;
    for (const [key, at] of this.lastVerifiedAt) {
      if (at < cutoff) this.lastVerifiedAt.delete(key);
    }
  };
}

export const orderPaymentService = new OrderPaymentService();
