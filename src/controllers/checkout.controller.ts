/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { CheckoutService } from "../services/checkout.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";

export class CheckoutController {
  checkoutService: CheckoutService;

  constructor() {
    this.checkoutService = new CheckoutService();
  }

  previewCheckout = handleAsyncControl(
    async (
      req: Request<{}, {}, { addressId: string; promoCode?: string }>,
      res: Response,
    ): Promise<Response> => {
      const customerId = req.user?._id as unknown as string;
      const preview = await this.checkoutService.previewCheckout(
        customerId,
        req.body.addressId,
        req.body.promoCode,
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
      );

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Checkout confirmed successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
