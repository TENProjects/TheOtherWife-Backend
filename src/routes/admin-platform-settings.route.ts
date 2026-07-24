/** @format */

import { Router } from "express";
import { PlatformSettingsController } from "../controllers/platform-settings.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  updateAutomationSettingsSchema,
  updateEmailSettingsSchema,
  updateNotificationSettingsSchema,
} from "../zod-schema/platform-settings.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";

/**
 * @swagger
 * /api/v1/admin/settings/notifications:
 *   get:
 *     summary: Get platform notification settings (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Notification settings fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update platform notification settings (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderStatusNotification: { type: boolean }
 *               systemUpdatesNotification: { type: boolean }
 *               promotionalNotification: { type: boolean }
 *     responses:
 *       "200":
 *         description: Notification settings updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/settings/email:
 *   get:
 *     summary: Get platform email notification settings (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Email settings fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update platform email notification settings (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerPurchaseReceipts: { type: boolean }
 *               customerPromotionalEmails: { type: boolean }
 *               vendorSalesNotification: { type: boolean }
 *               vendorCanceledOrderNotification: { type: boolean }
 *               vendorRatingNotification: { type: boolean }
 *               vendorPaymentNotification: { type: boolean }
 *               adminFailedSubscriptionCharges: { type: boolean }
 *     responses:
 *       "200":
 *         description: Email settings updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/settings/automation:
 *   get:
 *     summary: Get platform automation settings (admin)
 *     description: >-
 *       Abandoned cart/transaction reminder-email configuration. Reminder
 *       emails are dispatched by a scheduled cron job that reads these
 *       settings — this endpoint is configuration storage only.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Automation settings fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update platform automation settings (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               abandonedTransactionsEnabled: { type: boolean }
 *               abandonedCartsEnabled: { type: boolean }
 *               reminderAfterHours: { type: number, minimum: 1, maximum: 720 }
 *               abandonedCartEmailSubject: { type: string, maxLength: 200 }
 *               abandonedCartEmailBody: { type: string, maxLength: 5000 }
 *     responses:
 *       "200":
 *         description: Automation settings updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class AdminPlatformSettingsRouter {
  private controller: PlatformSettingsController;
  router: Router;

  constructor() {
    this.controller = new PlatformSettingsController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/notifications",
      this.controller.getNotificationSettings,
    );
    this.router.patch(
      "/notifications",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateNotificationSettingsSchema),
      this.controller.updateNotificationSettings,
    );

    this.router.get("/email", this.controller.getEmailSettings);
    this.router.patch(
      "/email",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateEmailSettingsSchema),
      this.controller.updateEmailSettings,
    );

    this.router.get("/automation", this.controller.getAutomationSettings);
    this.router.patch(
      "/automation",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateAutomationSettingsSchema),
      this.controller.updateAutomationSettings,
    );
  }
}

export const adminPlatformSettingsRouter = new AdminPlatformSettingsRouter()
  .router;
