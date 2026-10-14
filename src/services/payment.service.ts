/** @format */

import crypto from "crypto";
import { ClientSession } from "mongoose";
import Payment, { PaymentDocument } from "../models/payment.model.js";
import ScheduledMeal from "../models/scheduledMeal.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { InternalServerError } from "../errors/internal-server.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import {
  paystackCallbackUrl,
  paystackSecretKey,
  paystackBaseUrl,
} from "../constants/env.js";
import { transaction } from "../util/transaction.util.js";
import { PaymentLedgerService } from "./payment-ledger.service.js";
import { orderPaymentService } from "./order-payment.service.js";

type InitializePaystackInput = {
  email: string;
  amount: number;
  reference: string;
  orderId: string;
  paymentId: string;
  // Paystack Split Payment (spec section 3.2) — when the vendor has a
  // subaccount, this NGN amount (converted to kobo) is what the MAIN/platform
  // account retains; the remainder goes straight to the vendor's subaccount.
  // Omitted entirely for meal-plan payments and vendors without a subaccount
  // yet, in which case the full amount goes to the platform as before.
  subaccountCode?: string;
  mainAccountShare?: number;
};

type PaystackInitializeResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export class PaymentService {
  private paymentLedgerService: PaymentLedgerService;

  constructor() {
    this.paymentLedgerService = new PaymentLedgerService();
  }

  initializePaystackPayment = async (
    payload: InitializePaystackInput,
  ): Promise<PaystackInitializeResponse> => {
    if (!paystackSecretKey) {
      throw new InternalServerError(
        "Paystack secret key is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    const response = await fetch(
      `${paystackBaseUrl}/transaction/initialize`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: payload.email,
          amount: Math.round(payload.amount * 100),
          reference: payload.reference,
          callback_url: paystackCallbackUrl || undefined,
          metadata: {
            orderId: payload.orderId,
            paymentId: payload.paymentId,
          },
          ...(payload.subaccountCode
            ? {
                subaccount: payload.subaccountCode,
                // Overrides the subaccount's default percentage split for
                // this specific transaction — an absolute amount is the only
                // way to correctly reserve exactly (serviceCharge + VAT +
                // 20% of subtotal - Paystack fee) for the platform while the
                // vendor's subaccount receives exactly 80% of subtotal,
                // since Paystack's split otherwise applies one flat
                // percentage to the WHOLE transaction amount.
                transaction_charge: Math.round((payload.mainAccountShare ?? 0) * 100),
                bearer: "account",
              }
            : {}),
        }),
      },
    );

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: PaystackInitializeResponse;
    };

    if (!response.ok || !data.status || !data.data) {
      throw new BadRequestException(
        data.message || "Unable to initialize payment",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return data.data;
  };

  verifyPaystackSignature = (rawBody: string, signature?: string) => {
    if (!paystackSecretKey) {
      throw new InternalServerError(
        "Paystack secret key is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    if (!signature) {
      throw new BadRequestException(
        "Missing Paystack signature",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const expected = crypto
      .createHmac("sha512", paystackSecretKey)
      .update(rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  };

  handlePaystackWebhook = async (
    rawBody: string,
    signature: string | undefined,
    event: any,
  ) => {
    const isValidSignature = this.verifyPaystackSignature(rawBody, signature);

    if (!isValidSignature) {
      throw new BadRequestException(
        "Invalid Paystack signature",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );
    }

    if (event.event !== "charge.success" && event.event !== "charge.failed") {
      return { handled: false };
    }

    const reference = event.data?.reference as string | undefined;

    if (!reference) {
      throw new BadRequestException(
        "Payment reference is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const payment = await Payment.findOne({ reference });

    if (!payment) {
      throw new NotFoundException(
        "Payment not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    // Meal-plan payments have no linked Order — they pay upfront for a
    // batch of ScheduledMeal instances instead, so this branch mirrors only
    // the Payment + ScheduledMeal side of the logic (no cart-clear, wallet,
    // promo, or vendor-settlement steps, since none of those apply to a
    // meal-plan batch).
    if (payment.context === "meal_plan") {
      return this.handleMealPlanPaystackEvent(payment, event);
    }

    // Order payments go through the shared lifecycle (order-payment.service):
    // atomic, idempotent transitions guarded on status "pending_payment", the
    // vendor notified only once paid, and a payment that lands after its
    // checkout was closed refunded instead of resurrected.
    if (event.event === "charge.failed") {
      return orderPaymentService.failOrderPayment(payment._id.toString(), event.data ?? {});
    }

    const result = await orderPaymentService.confirmOrderPayment(
      payment._id.toString(),
      event.data ?? {},
      "webhook",
      event.event,
    );

    return { handled: true, outcome: result.outcome };
  };

  // Meal-plan counterpart of the charge.success/charge.failed handling
  // above — same idempotency guard (skip if already "succeeded"), same
  // amount-mismatch check, but only touches Payment + the ScheduledMeal
  // batch it paid for (no Order, no wallet, no promo, no cart, no vendor
  // settlement — none of those apply to a meal-plan batch).
  private handleMealPlanPaystackEvent = async (
    payment: PaymentDocument,
    event: any,
  ) => {
    if (event.event === "charge.failed") {
      const result = await transaction.use(
        async (
          session: ClientSession,
          paymentId: string,
          providerPayload: Record<string, unknown>,
        ) => {
          const paymentRecord = await Payment.findById(paymentId).session(session);

          if (!paymentRecord) {
            throw new NotFoundException(
              "Payment not found",
              HttpStatus.NOT_FOUND,
              ErrorCode.RESOURCE_NOT_FOUND,
            );
          }

          if (paymentRecord.status === "succeeded") {
            return { handled: true, payment: paymentRecord };
          }

          const previousStatus = paymentRecord.status;
          paymentRecord.status = "failed";
          paymentRecord.providerPayload = providerPayload;
          await paymentRecord.save({ session });

          await ScheduledMeal.updateMany(
            { paymentId: paymentRecord._id },
            { $set: { paymentStatus: "failed" } },
            { session },
          );

          await this.paymentLedgerService.record(session, {
            payment: paymentRecord,
            entryType: "payment_failed",
            amount: 0,
            previousStatus,
            actorType: "webhook",
            metadata: { paystackEvent: "charge.failed", context: "meal_plan" },
          });

          return { handled: true, payment: paymentRecord };
        },
      )(payment._id.toString(), event.data);

      return result;
    }

    if (payment.status === "succeeded") {
      return { handled: true, payment };
    }

    const paidAmount = Number(event.data?.amount ?? 0) / 100;

    if (paidAmount !== payment.amount) {
      throw new BadRequestException(
        "Payment amount mismatch",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const result = await transaction.use(
      async (session: ClientSession, paymentId: string, providerPayload: any) => {
        const paymentRecord = await Payment.findById(paymentId).session(session);

        if (!paymentRecord) {
          throw new NotFoundException(
            "Payment not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        if (paymentRecord.status === "succeeded") {
          return { handled: true, payment: paymentRecord };
        }

        const previousStatus = paymentRecord.status;
        paymentRecord.status = "succeeded";
        paymentRecord.providerTransactionId = String(providerPayload.id ?? "");
        paymentRecord.providerPayload = providerPayload;
        paymentRecord.paidAt = providerPayload.paid_at
          ? new Date(providerPayload.paid_at)
          : new Date();
        await paymentRecord.save({ session });

        await ScheduledMeal.updateMany(
          { paymentId: paymentRecord._id },
          { $set: { paymentStatus: "succeeded" } },
          { session },
        );

        await this.paymentLedgerService.record(session, {
          payment: paymentRecord,
          entryType: "payment_succeeded",
          amount: paidAmount,
          previousStatus,
          actorType: "webhook",
          metadata: { paystackEvent: event.event, context: "meal_plan", reference: paymentRecord.reference },
        });

        return { handled: true, payment: paymentRecord };
      },
    )(payment._id.toString(), event.data);

    return result;
  };
}
