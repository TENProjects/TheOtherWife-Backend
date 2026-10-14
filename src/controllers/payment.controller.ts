/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { PaymentService } from "../services/payment.service.js";
import { HttpStatus } from "../config/http.config.js";

// The only Paystack references this platform ever issues: orders
// ("tow_" + 32 hex) and meal plans ("tow_mp_" + 32 hex).
const PAYSTACK_REFERENCE_PATTERN = /^tow_(?:mp_)?[a-f0-9]{32}$/;
// Fixed in-app destination — never derived from request input, so this can't
// be used as an open redirect.
const APP_PAYMENT_RETURN_URL = "tow://payment-complete";

export class PaymentController {
  paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  // Paystack's callback_url (set via PAYSTACK_CALLBACK_URL) lands here after
  // checkout; we bounce straight back into the app so the in-app browser
  // closes. This never changes payment state — the app then calls
  // POST /checkout/orders/:orderId/verify-payment, and the webhook remains the
  // source of truth.
  paystackReturn = (req: Request, res: Response) => {
    const raw = req.query.reference ?? req.query.trxref;
    const reference =
      typeof raw === "string" && PAYSTACK_REFERENCE_PATTERN.test(raw) ? raw : null;
    const target = reference
      ? `${APP_PAYMENT_RETURN_URL}?reference=${reference}`
      : APP_PAYMENT_RETURN_URL;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    return res.redirect(302, target);
  };

  handlePaystackWebhook = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const signature = req.headers["x-paystack-signature"] as string | undefined;
      const result = await this.paymentService.handlePaystackWebhook(
        req.rawBody ?? "",
        signature,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: result.handled
          ? "Webhook processed successfully"
          : "Webhook event ignored",
      });
    },
  );
}
