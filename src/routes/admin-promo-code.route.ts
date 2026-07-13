/** @format */

import { Router } from "express";
import { PromoCodeController } from "../controllers/promo-code.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  createPromoCodeSchema,
  updatePromoCodeSchema,
} from "../zod-schema/promo-code.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/promo-codes:
 *   get:
 *     summary: List TOW promo codes (admin)
 *     description: >-
 *       TOW-issued, customer-entered checkout discount codes (Financial &
 *       Commission Spec v1.0, section 5.1) — distinct from the automatic
 *       first-100-orders cashback campaign, which has no customer-facing code.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Promo codes fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   post:
 *     summary: Create a new TOW promo code (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, discountType, discountValue]
 *             properties:
 *               code: { type: string, minLength: 3, maxLength: 30 }
 *               discountType: { type: string, enum: [fixed, percentage] }
 *               discountValue:
 *                 type: number
 *                 description: NGN amount if fixed, 0-100 if percentage
 *               expiresAt: { type: string, format: date-time }
 *               maxUses: { type: number, minimum: 1 }
 *               minOrderValue: { type: number, minimum: 0, default: 0 }
 *     responses:
 *       "201":
 *         description: Promo code created successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "409":
 *         description: Code already exists
 */

/**
 * @swagger
 * /api/v1/admin/promo-codes/{id}:
 *   get:
 *     summary: Get a promo code by id (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Promo code fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   patch:
 *     summary: Update or deactivate a promo code (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive: { type: boolean }
 *               discountValue: { type: number }
 *               expiresAt: { type: string, format: date-time }
 *               maxUses: { type: number, minimum: 1 }
 *               minOrderValue: { type: number, minimum: 0 }
 *     responses:
 *       "200":
 *         description: Promo code updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

class AdminPromoCodeRouter {
  private promoCodeController: PromoCodeController;
  router: Router;

  constructor() {
    this.promoCodeController = new PromoCodeController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.promoCodeController.getAdminPromoCodes);
    this.router.post(
      "/",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(createPromoCodeSchema),
      this.promoCodeController.createPromoCode,
    );
    this.router.get("/:id", this.promoCodeController.getAdminPromoCodeById);
    this.router.patch(
      "/:id",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updatePromoCodeSchema),
      this.promoCodeController.updatePromoCode,
    );
  }
}

export const adminPromoCodeRouter = new AdminPromoCodeRouter().router;
