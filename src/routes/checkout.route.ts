/** @format */

import { Router } from "express";
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
  }
}

export const checkoutRouter = new CheckoutRouter().router;
