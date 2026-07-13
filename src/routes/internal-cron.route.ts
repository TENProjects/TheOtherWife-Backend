/** @format */

import { Router } from "express";
import { InternalCronController } from "../controllers/internal-cron.controller.js";
import { cronAuthMiddleware } from "../middlewares/cron-auth.middleware.js";

/**
 * @swagger
 * /api/v1/internal/cron/meal-plans/process-due:
 *   get:
 *     summary: Convert due meal-plan scheduled meals into vendor-facing orders (internal)
 *     description: >-
 *       Cron-only endpoint (Vercel Cron, see vercel.json) — never called by
 *       app users. Requires `Authorization: Bearer <CRON_SECRET>`. Finds
 *       every scheduled meal due within the fulfillment lead time
 *       (MEAL_PLAN_FULFILLMENT_LEAD_HOURS in meal-plan-fulfillment.service.ts)
 *       that hasn't yet been converted, and creates a real Order + Payment
 *       for each so it enters the vendor's normal Accept/Preparing/
 *       Out-for-delivery/Delivered flow and push notifications.
 *     tags: [Internal]
 *     security: []
 *     responses:
 *       "200":
 *         description: Due scheduled meals processed successfully
 *       "401":
 *         description: Unauthorized — missing or incorrect CRON_SECRET bearer token
 *       "500":
 *         description: CRON_SECRET is not configured on this server
 */
class InternalCronRouter {
  private controller: InternalCronController;
  router: Router;

  constructor() {
    this.controller = new InternalCronController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    // Vercel Cron always issues a GET request to the configured path (the
    // HTTP method isn't configurable in vercel.json's `crons` entry).
    this.router.get(
      "/meal-plans/process-due",
      cronAuthMiddleware,
      this.controller.processDueMealPlanScheduledMeals,
    );
  }
}

export const internalCronRouter = new InternalCronRouter().router;
