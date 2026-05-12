/** @format */

import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";

/**
 * @swagger
 * /api/v1/analytics:
 *   get:
 *     summary: Get admin analytics summary
 *     tags: [Analytics]
 *     responses:
 *       "200":
 *         description: Admin analytics fetched successfully
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
 *     tags: [Analytics]
 *     responses:
 *       "200":
 *         description: Admin order analytics fetched successfully
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
    this.router.use(authMiddleware, roleGuardMiddleware(["admin"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.userController.getAdminAnalytics);
    this.router.get("/orders", this.userController.getAdminOrderAnalytics);
  }
}

export const analyticsRouter = new AnalyticsRouter().router;
