/** @format */

import { Router } from "express";
import { NotificationController } from "../controllers/notification.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { sendNotificationSchema } from "../zod-schema/notification.schema.js";

/**
 * @swagger
 * /api/v1/admin/notifications:
 *   get:
 *     summary: List all notifications sent across the platform
 *     tags: [Admin - Notifications]
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
 *         name: recipientType
 *         schema: { type: string, enum: [customer, vendor, admin] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [order_update, vendor_approval, support_ticket, payout, system] }
 *       - in: query
 *         name: recipientUserId
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Notifications fetched successfully
 *   post:
 *     summary: Manually send a notification to a specific customer or vendor
 *     tags: [Admin - Notifications]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientUserId, recipientType, title, body]
 *             properties:
 *               recipientUserId: { type: string }
 *               recipientType: { type: string, enum: [customer, vendor, admin] }
 *               title: { type: string }
 *               body: { type: string }
 *     responses:
 *       "201":
 *         description: Notification sent successfully
 */

class AdminNotificationRouter {
  router: Router;
  controller: NotificationController;

  constructor() {
    this.router = Router();
    this.controller = new NotificationController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager", "support_agent"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getAdminNotifications);
    this.router.post(
      "/",
      zodValidation(sendNotificationSchema),
      this.controller.sendNotification,
    );
  }
}

export const adminNotificationRouter = new AdminNotificationRouter().router;
