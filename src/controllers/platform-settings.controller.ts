/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { PlatformSettingsService } from "../services/platform-settings.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class PlatformSettingsController {
  private platformSettingsService: PlatformSettingsService;

  constructor() {
    this.platformSettingsService = new PlatformSettingsService();
  }

  getNotificationSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const settings = await this.platformSettingsService.getNotificationSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Notification settings fetched successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  updateNotificationSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          orderStatusNotification?: boolean;
          systemUpdatesNotification?: boolean;
          promotionalNotification?: boolean;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const settings = await this.platformSettingsService.updateNotificationSettings(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "platform_settings.notifications_update",
        targetType: "PlatformSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Notification settings updated successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  getEmailSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const settings = await this.platformSettingsService.getEmailSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Email settings fetched successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  updateEmailSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          customerPurchaseReceipts?: boolean;
          customerPromotionalEmails?: boolean;
          vendorSalesNotification?: boolean;
          vendorCanceledOrderNotification?: boolean;
          vendorRatingNotification?: boolean;
          vendorPaymentNotification?: boolean;
          adminFailedSubscriptionCharges?: boolean;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const settings = await this.platformSettingsService.updateEmailSettings(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "platform_settings.email_update",
        targetType: "PlatformSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Email settings updated successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  getAutomationSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const settings = await this.platformSettingsService.getAutomationSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Automation settings fetched successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  updateAutomationSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          abandonedTransactionsEnabled?: boolean;
          abandonedCartsEnabled?: boolean;
          reminderAfterHours?: number;
          abandonedCartEmailSubject?: string;
          abandonedCartEmailBody?: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const settings = await this.platformSettingsService.updateAutomationSettings(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "platform_settings.automation_update",
        targetType: "PlatformSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Automation settings updated successfully",
        data: settings,
      } as ApiResponse);
    },
  );
}
