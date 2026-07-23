/** @format */

import { Router } from "express";
import { AdminReviewController } from "../controllers/admin-review.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { updateReviewStatusSchema } from "../zod-schema/admin-review.schema.js";

/**
 * @swagger
 * /api/v1/admin/reviews:
 *   get:
 *     summary: List meal reviews for moderation
 *     tags: [Admin - Reviews]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string }
 *       - in: query
 *         name: moderationStatus
 *         schema: { type: string, enum: [visible, hidden] }
 *       - in: query
 *         name: rating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
 *     responses:
 *       "200":
 *         description: Reviews fetched successfully
 *
 * /api/v1/admin/reviews/{id}:
 *   get:
 *     summary: Get a single review
 *     tags: [Admin - Reviews]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Review fetched successfully
 *       "404":
 *         description: Review not found
 *   delete:
 *     summary: >-
 *       Permanently delete a review. Reviews still auto-publish on creation
 *       exactly as before this endpoint existed — this is a moderation
 *       takedown tool, not a change to that flow.
 *     tags: [Admin - Reviews]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Review deleted successfully
 *
 * /api/v1/admin/reviews/{id}/status:
 *   patch:
 *     summary: >-
 *       Hide or unhide a review. Hiding excludes it from the vendor/meal
 *       rating aggregates immediately; unhiding restores it.
 *     tags: [Admin - Reviews]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [moderationStatus]
 *             properties:
 *               moderationStatus: { type: string, enum: [visible, hidden] }
 *     responses:
 *       "200":
 *         description: Review updated successfully
 */

class AdminReviewRouter {
  router: Router;
  controller: AdminReviewController;

  constructor() {
    this.router = Router();
    this.controller = new AdminReviewController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager", "support_agent"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getReviews);
    this.router.get("/:id", this.controller.getReviewById);
    this.router.patch(
      "/:id/status",
      zodValidation(updateReviewStatusSchema),
      this.controller.updateStatus,
    );
    this.router.delete("/:id", this.controller.deleteReview);
  }
}

export const adminReviewRouter = new AdminReviewRouter().router;
