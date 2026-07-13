/** @format */

import { Router } from "express";
import { AdminMealPlanController } from "../controllers/admin-meal-plan.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/meal-plans:
 *   get:
 *     summary: List active meal plans (admin)
 *     description: >-
 *       Read-only monitoring list — each plan includes its next upcoming
 *       scheduled meal. Does not support editing/cancelling plans.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Active meal plans fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/meal-plans/scheduled-meal-monitor:
 *   get:
 *     summary: List scheduled meals needing admin attention (admin)
 *     description: >-
 *       Scheduled meals due within the next 24 hours or overdue in the last
 *       48 hours, each annotated with a `flag` explaining its status:
 *       "due_soon_not_yet_converted" / "overdue_not_converted" (the
 *       fulfillment cron hasn't turned it into an order yet — check
 *       CRON_SECRET/Vercel cron health), "vendor_hasnt_accepted" /
 *       "vendor_action_overdue" (order exists but the vendor hasn't
 *       progressed it in time), or "on_track".
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Scheduled meal monitor fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
class AdminMealPlanRouter {
  private controller: AdminMealPlanController;
  router: Router;

  constructor() {
    this.controller = new AdminMealPlanController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.listActivePlans);
    this.router.get(
      "/scheduled-meal-monitor",
      this.controller.getScheduledMealMonitor,
    );
  }
}

export const adminMealPlanRouter = new AdminMealPlanRouter().router;
