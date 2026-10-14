/** @format */

import { Router, type Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { CheckoutController } from "../controllers/checkout.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  checkoutConfirmSchema,
  checkoutPreviewSchema,
} from "../zod-schema/checkout.schema.js";

/**
 * @swagger
 * /api/v1/checkout/preview:
 *   post:
 *     summary: Generate a checkout preview for the active cart
 *     description: >-
 *       Pricing per the Financial & Commission Specification v1.0: processing
 *       fee is 4.9% below N15,000 subtotal, 2.9% at/above (calculated on the
 *       promo-discounted subtotal if a promoCode is applied); VAT is 7.5% on
 *       the processing fee only, and only when the admin has toggled VAT on;
 *       there is no delivery fee. Rejects with 400 if the meal subtotal
 *       (before any discount) is below the N2,000 minimum, or if promoCode
 *       cannot be applied (invalid/expired/exhausted/below its own minimum,
 *       or the cart already contains a vendor-discounted item).
 *     tags: [Checkout]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressId]
 *             properties:
 *               addressId:
 *                 type: string
 *               promoCode:
 *                 type: string
 *                 description: Optional TOW promo code to apply (see /admin/promo-codes)
 *     responses:
 *       "200":
 *         description: Checkout preview generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "400":
 *         description: >-
 *           Validation error — includes below-minimum-order-value and
 *           invalid/inapplicable promo code cases
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/checkout/confirm:
 *   post:
 *     summary: Create a pending order and initialize payment
 *     description: >-
 *       If promoCode is supplied, it is re-validated and its usage count is
 *       atomically incremented here (unlike /preview, which only validates —
 *       previewing never consumes a redemption).
 *     tags: [Checkout]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CheckoutConfirmRequest"
 *           examples:
 *             paystack:
 *               summary: Confirm checkout with Paystack
 *               value:
 *                 addressId: "67ff2f8be1234567890abcde"
 *                 cartUpdatedAt: "2026-03-17T12:00:00.000Z"
 *                 useWallet: false
 *                 paymentProvider: "paystack"
 *             cash:
 *               summary: Confirm checkout with cash payment
 *               value:
 *                 addressId: "67ff2f8be1234567890abcde"
 *                 cartUpdatedAt: "2026-03-17T12:00:00.000Z"
 *                 useWallet: false
 *                 paymentProvider: "cash"
 *             split:
 *               summary: Confirm checkout with wallet + Paystack split
 *               value:
 *                 addressId: "67ff2f8be1234567890abcde"
 *                 cartUpdatedAt: "2026-03-17T12:00:00.000Z"
 *                 useWallet: true
 *                 paymentProvider: "paystack"
 *     responses:
 *       "201":
 *         description: Checkout confirmed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: "#/components/schemas/CheckoutConfirmResponse"
 *       "400":
 *         description: Validation error
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

// Per-customer limits for the post-payment endpoints. verify-payment is
// polled by the app for ~15s after Paystack closes, so it gets room for that;
// every call that reaches Paystack is additionally throttled per order.
const keyByUser = (req: Request): string =>
  req.user?._id?.toString() ?? (req.ip ? ipKeyGenerator(req.ip) : "unknown");

const verifyPaymentRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  validate: { xForwardedForHeader: false },
  message: { status: "error", message: "Too many payment status checks. Please wait a moment." },
});

const cancelCheckoutRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  validate: { xForwardedForHeader: false },
  message: { status: "error", message: "Too many attempts. Please try again later." },
});

/**
 * @swagger
 * /api/v1/checkout/orders/{orderId}/verify-payment:
 *   post:
 *     summary: Server-verified payment status of the customer's checkout
 *     description: >-
 *       Called by the app after the Paystack page closes (whatever the
 *       browser result). While the checkout is unpaid, the server verifies
 *       the transaction with Paystack directly and records a success
 *       immediately. Returns paymentState pending | paid | failed |
 *       refund_pending, the Paystack authorizationUrl only while still
 *       pending (to resume the same payment), and pickupLocation only once a
 *       pick-up order is paid. Owner-only; rate-limited.
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Payment state
 *       "404":
 *         description: Not found (or not the caller's order)
 *       "429":
 *         description: Too many requests
 *
 * /api/v1/checkout/orders/{orderId}/cancel:
 *   post:
 *     summary: Cancel an unpaid checkout
 *     description: >-
 *       Closes the customer's unpaid checkout and releases any reserved wallet
 *       funds and promo redemption. Paystack is re-checked first: if the
 *       payment actually went through, the order is confirmed instead and
 *       paymentState "paid" is returned. 409 if the order is already paid.
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Resulting payment state
 *       "404":
 *         description: Not found (or not the caller's order)
 *       "409":
 *         description: Already paid
 */

class CheckoutRouter {
  checkoutController: CheckoutController;
  router: Router;

  constructor() {
    this.checkoutController = new CheckoutController();
    this.router = Router();
    this.router.use(authMiddleware);
    this.router.use(roleGuardMiddleware(["customer"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/preview",
      zodValidation(checkoutPreviewSchema),
      this.checkoutController.previewCheckout,
    );
    this.router.post(
      "/confirm",
      zodValidation(checkoutConfirmSchema),
      this.checkoutController.confirmCheckout,
    );
    this.router.post(
      "/orders/:orderId/verify-payment",
      verifyPaymentRateLimit,
      this.checkoutController.verifyCheckoutPayment,
    );
    this.router.post(
      "/orders/:orderId/cancel",
      cancelCheckoutRateLimit,
      this.checkoutController.cancelCheckout,
    );
  }
}

export const checkoutRouter = new CheckoutRouter().router;
