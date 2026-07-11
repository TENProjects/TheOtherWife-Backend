/** @format */

import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/analytics:
 *   get:
 *     summary: Get admin analytics summary
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Admin analytics fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalCustomers: { type: number }
 *                         totalCustomersChange:
 *                           type: number
 *                           description: Percent change vs. previous calendar month
 *                         totalOrders: { type: number }
 *                         totalOrdersChange: { type: number }
 *                         totalRevenue: { type: number }
 *                         totalRevenueChange: { type: number }
 *                         totalMenus: { type: number }
 *                         totalMenusChange:
 *                           type: number
 *                           nullable: true
 *                           description: >-
 *                             Always null — meal documents don't track a
 *                             creation timestamp, so this can't be computed.
 *                         vendors:
 *                           type: object
 *                           properties:
 *                             total: { type: number }
 *                             pending: { type: number }
 *                             approved: { type: number }
 *                             suspended: { type: number }
 *                             rejected: { type: number }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/analytics/orders:
 *   get:
 *     summary: Get admin orders analytics breakdown
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Admin order analytics fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         orderCategories:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               category: { type: string }
 *                               count: { type: number }
 *                         paymentStatusBreakdown:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               status: { type: string }
 *                               count: { type: number }
 *                         orderSummary:
 *                           type: object
 *                           properties:
 *                             completed: { type: number }
 *                             inProgress: { type: number }
 *                             cancelled: { type: number }
 *                         revenueTrend:
 *                           type: array
 *                           description: Last 6 calendar months
 *                           items:
 *                             type: object
 *                             properties:
 *                               month: { type: string, example: "2026-07" }
 *                               revenue: { type: number }
 *                         trendingMenus:
 *                           type: array
 *                           description: Top 10 meals by order count this month
 *                           items:
 *                             type: object
 *                             properties:
 *                               name: { type: string }
 *                               orders: { type: number }
 *                               price: { type: number }
 *                               change:
 *                                 type: number
 *                                 description: Percent change vs. last month's order count
 *                         locationDist:
 *                           type: array
 *                           description: Top 10 cities by order count
 *                           items:
 *                             type: object
 *                             properties:
 *                               city: { type: string }
 *                               value: { type: number }
 *                               percent: { type: number }
 *                         genderDist:
 *                           type: array
 *                           description: >-
 *                             Always empty — gender is not currently captured
 *                             anywhere in the user/customer schema.
 *                           items:
 *                             type: object
 *                         rejectedOrders:
 *                           type: array
 *                           description: Last 10 vendor-rejected orders
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string }
 *                               date: { type: string, format: date-time }
 *                               reason:
 *                                 type: string
 *                                 nullable: true
 *                                 description: >-
 *                                   Always null — vendor order rejection
 *                                   doesn't currently capture a reason.
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class AnalyticsRouter {
  userController: UserController;
  router: Router;

  constructor() {
    this.userController = new UserController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.userController.getAdminAnalytics);
    this.router.get("/orders", this.userController.getAdminOrderAnalytics);
  }
}

export const analyticsRouter = new AnalyticsRouter().router;
