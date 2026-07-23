/** @format */

import { Router } from "express";
import { NotificationController } from "../controllers/notification.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: List the current user's notifications (vendor or customer)
 *     tags: [Notifications]
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
 *         name: unreadOnly
 *         schema: { type: boolean }
 *     responses:
 *       "200":
 *         description: Notifications fetched successfully
 *
 * /api/v1/notifications/read-all:
 *   patch:
 *     summary: Mark all of the current user's notifications as read
 *     tags: [Notifications]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       "200":
 *         description: All notifications marked as read
 *
 * /api/v1/notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Notification marked as read
 *       "404":
 *         description: Notification not found
 *
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     tags: [Notifications]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Notification deleted successfully
 *       "404":
 *         description: Notification not found
 */

class NotificationRouter {
  router: Router;
  controller: NotificationController;

  constructor() {
    this.router = Router();
    this.controller = new NotificationController();
    this.router.use(authMiddleware, roleGuardMiddleware(["customer", "vendor"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getMyNotifications);
    this.router.patch("/read-all", this.controller.markAllAsRead);
    this.router.patch("/:id/read", this.controller.markAsRead);
    this.router.delete("/:id", this.controller.deleteNotification);
  }
}

export const notificationRouter = new NotificationRouter().router;
