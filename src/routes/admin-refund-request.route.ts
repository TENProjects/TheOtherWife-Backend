/** @format */

import { Router } from "express";
import { RefundController } from "../controllers/refund.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { decideRefundRequestSchema } from "../zod-schema/refund.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/refund-requests:
 *   get:
 *     summary: List refund requests (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *     responses:
 *       "200":
 *         description: Refund requests fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/refund-requests/{id}:
 *   get:
 *     summary: Get a refund request by id (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Refund request fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   patch:
 *     summary: Approve or reject a refund request (admin) — Refund Scenario B
 *     description: >-
 *       Approving credits the customer's wallet with the full/partial
 *       refund amount (Financial & Commission Spec v1.0, section 4.2). The
 *       vendor's payout is NEVER clawed back for this scenario — they
 *       fulfilled the order, so they keep it; TOW absorbs the refund from
 *       its own revenue. Requires a mandatory `adminNotes` reason and
 *       `confirm: true` as an explicit second confirmation. Does NOT call
 *       Paystack's refund API — no real money leaves the platform's Paystack
 *       balance, this is an internal wallet-ledger movement.
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
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [approve, reject] }
 *               approvedAmount:
 *                 type: number
 *                 description: >-
 *                   Overrides the originally-requested amount (full or
 *                   partial refund) — defaults to the request's amount if
 *                   omitted. Cannot exceed the order total.
 *               adminNotes:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Required when decision is "approve".
 *               confirm:
 *                 type: boolean
 *                 enum: [true]
 *                 description: Required (must be exactly true) when decision is "approve".
 *     responses:
 *       "200":
 *         description: Refund request decided successfully
 *       "400":
 *         description: Bad request (already decided)
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

class AdminRefundRequestRouter {
  private refundController: RefundController;
  router: Router;

  constructor() {
    this.refundController = new RefundController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.refundController.getAdminRefundRequests);
    this.router.get("/:id", this.refundController.getAdminRefundRequestById);
    this.router.patch(
      "/:id",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(decideRefundRequestSchema),
      this.refundController.decideRefundRequest,
    );
  }
}

export const adminRefundRequestRouter = new AdminRefundRequestRouter().router;
