/** @format */

import { Router } from "express";
import { PaymentController } from "../controllers/payment.controller.js";

/**
 * @swagger
 * /api/v1/payments/webhook:
 *   post:
 *     summary: Receive Paystack webhook events
 *     tags: [Payment]
 *     responses:
 *       "200":
 *         description: Webhook processed successfully
 *       "400":
 *         description: Invalid webhook payload or signature
 *
 * /api/v1/payments/paystack/return:
 *   get:
 *     summary: Paystack checkout return URL (redirects back into the app)
 *     description: >-
 *       Target of PAYSTACK_CALLBACK_URL. Validates the reference format and
 *       302-redirects to the fixed app URL tow://payment-complete. Never
 *       changes payment state — the app verifies via
 *       POST /api/v1/checkout/orders/{orderId}/verify-payment.
 *     tags: [Payment]
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema: { type: string }
 *     responses:
 *       "302":
 *         description: Redirect to the app
 */

class PaymentRouter {
  paymentController: PaymentController;
  router: Router;

  constructor() {
    this.paymentController = new PaymentController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post("/webhook", this.paymentController.handlePaystackWebhook);
    this.router.get("/paystack/return", this.paymentController.paystackReturn);
    this.router.post("/paystack/transfer-approval", this.paymentController.approvePaystackTransfer);
  }
}

export const paymentRouter = new PaymentRouter().router;
