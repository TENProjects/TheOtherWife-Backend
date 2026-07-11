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
 *     summary: Approve or reject a refund request (admin)
 *     description: >-
 *       Approving marks the order/payment as refunded in our own records
 *       only — it does NOT call Paystack's refund API, so no real money
 *       movement is triggered. Actual payout back to the customer still
 *       requires a manual Paystack dashboard refund (or a future API
 *       integration).
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
 *               adminNotes: { type: string, maxLength: 1000 }
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
