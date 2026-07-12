/** @format */

import crypto from "crypto";
import { ClientSession } from "mongoose";
import Payment, { PaymentDocument } from "../models/payment.model.js";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
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
import { PromoService } from "./promo.service.js";
import { WalletService } from "./wallet.service.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import { VendorWalletService } from "./vendor-wallet.service.js";

type InitializePaystackInput = {
  email: string;
  amount: number;
  reference: string;
  orderId: string;
  paymentId: string;
};

type PaystackInitializeResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export class PaymentService {
  private promoService: PromoService;
  private walletService: WalletService;
  private vendorWalletService: VendorWalletService;

  constructor() {
    this.promoService = new PromoService();
    this.walletService = new WalletService();
    this.vendorWalletService = new VendorWalletService();
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

    return expected === signature;
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
    // the Payment + ScheduledMeal side of the logic below (no cart-clear,
    // wallet, promo, or vendor-settlement steps, since none of those apply
    // to a meal-plan batch).
    if (payment.context === "meal_plan") {
      return this.handleMealPlanPaystackEvent(payment, event);
    }

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

          paymentRecord.status = "failed";
          paymentRecord.providerPayload = providerPayload;
          await paymentRecord.save({ session });

          const order = await Order.findById(paymentRecord.orderId).session(session);

          if (!order) {
            throw new NotFoundException(
              "Order not found",
              HttpStatus.NOT_FOUND,
              ErrorCode.RESOURCE_NOT_FOUND,
            );
          }

          order.paymentStatus = "failed";
          order.status = "payment_failed";
          await order.save({ session });

          await this.walletService.releaseReservedWalletForOrder(
            session,
            paymentRecord.customerId.toString(),
            order._id.toString(),
          );

          await this.vendorWalletService.syncPaymentSettlementFromOrder(
            session,
            paymentRecord._id.toString(),
          );

          return { handled: true, payment: paymentRecord, order };
        },
      )(payment._id.toString(), event.data);

      if (result.order) {
        await appSignalDispatcher.emit("order.status_changed", {
          orderId: result.order._id.toString(),
          customerUserId: result.order.customerId.toString(),
          vendorId: result.order.vendorId.toString(),
          previousStatus: "pending_payment",
          currentStatus: "payment_failed",
        });
      }

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

        paymentRecord.status = "succeeded";
        paymentRecord.providerTransactionId = String(providerPayload.id ?? "");
        paymentRecord.providerPayload = providerPayload;
        paymentRecord.paidAt = providerPayload.paid_at
          ? new Date(providerPayload.paid_at)
          : new Date();
        await paymentRecord.save({ session });

        const order = await Order.findById(paymentRecord.orderId).session(session);

        if (!order) {
          throw new NotFoundException(
            "Order not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        order.paymentStatus = "succeeded";
        order.status = "paid";
        order.paidAt = paymentRecord.paidAt;
        await order.save({ session });

        await this.walletService.finalizeReservedWalletForOrder(
          session,
          paymentRecord.customerId.toString(),
          order._id.toString(),
        );

        try {
          await this.promoService.creditEligiblePaidOrder(session, order);
        } catch (error: any) {
          console.error("Skipping promo credit after webhook confirmation", {
            orderId: order._id?.toString?.(),
            paymentId: paymentRecord._id?.toString?.(),
            message: error?.message,
          });
        }

        await Cart.findOneAndUpdate(
          { customerId: paymentRecord.customerId },
          {
            $set: {
              meals: [],
              totalAmount: 0,
            },
          },
          { session },
        );

        await this.vendorWalletService.syncPaymentSettlementFromOrder(
          session,
          paymentRecord._id.toString(),
        );

        return { handled: true, payment: paymentRecord, order };
      },
    )(payment._id.toString(), event.data);

    if (result.order) {
      await appSignalDispatcher.emit("order.status_changed", {
        orderId: result.order._id.toString(),
        customerUserId: result.order.customerId.toString(),
        vendorId: result.order.vendorId.toString(),
        previousStatus: "pending_payment",
        currentStatus: "paid",
      });
    }

    return result;
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

          paymentRecord.status = "failed";
          paymentRecord.providerPayload = providerPayload;
          await paymentRecord.save({ session });

          await ScheduledMeal.updateMany(
            { paymentId: paymentRecord._id },
            { $set: { paymentStatus: "failed" } },
            { session },
          );

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

        return { handled: true, payment: paymentRecord };
      },
    )(payment._id.toString(), event.data);

    return result;
  };
}
