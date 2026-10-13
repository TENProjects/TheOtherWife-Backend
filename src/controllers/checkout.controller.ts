/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { CheckoutService, type FulfillmentType } from "../services/checkout.service.js";
import { orderPaymentService } from "../services/order-payment.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";

export class CheckoutController {
  checkoutService: CheckoutService;

  constructor() {
    this.checkoutService = new CheckoutService();
  }

  previewCheckout = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { addressId: string; promoCode?: string; fulfillmentType?: FulfillmentType }
      >,
      res: Response,
    ): Promise<Response> => {
      const customerId = req.user?._id as unknown as string;
      const preview = await this.checkoutService.previewCheckout(
        customerId,
        req.body.addressId,
        req.body.promoCode,
        req.body.fulfillmentType,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Checkout preview generated successfully",
        data: preview,
      } as ApiResponse);
    },
  );

  confirmCheckout = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          addressId: string;
          cartUpdatedAt: string;
          useWallet?: boolean;
          paymentProvider?: "paystack" | "cash" | "wallet";
          promoCode?: string;
          fulfillmentType?: FulfillmentType;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const customerId = req.user?._id as unknown as string;
      const result = await this.checkoutService.confirmCheckout(
        customerId,
        req.body.addressId,
        req.body.cartUpdatedAt,
        req.body.useWallet,
        req.body.paymentProvider,
        req.body.promoCode,
        req.body.fulfillmentType,
      );

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Checkout confirmed successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // Server-authoritative payment state after the customer returns from
  // Paystack (verifies with Paystack directly while still unpaid).
  verifyCheckoutPayment = handleAsyncControl(
    async (req: Request<{ orderId: string }>, res: Response): Promise<Response> => {
      const customerId = req.user?._id as unknown as string;
      const state = await orderPaymentService.getCheckoutPaymentState(
        customerId,
        req.params.orderId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Payment status fetched successfully",
        data: state,
      } as ApiResponse);
    },
  );

  // The customer abandoned the payment: close the unpaid checkout now
  // (re-checking Paystack first so a completed payment is never cancelled).
  cancelCheckout = handleAsyncControl(
    async (req: Request<{ orderId: string }>, res: Response): Promise<Response> => {
      const customerId = req.user?._id as unknown as string;
      const state = await orderPaymentService.cancelCustomerCheckout(
        customerId,
        req.params.orderId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message:
          state.paymentState === "paid"
            ? "This order was already paid, so it was not cancelled"
            : "Checkout cancelled",
        data: state,
      } as ApiResponse);
    },
  );
}
