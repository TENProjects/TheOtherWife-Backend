/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { NotificationService } from "../services/notification.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

type IdParam = { id: string };

export class NotificationController {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  // ── Self-service (customer/vendor, whoever is authenticated) ────────

  getMyNotifications = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const { page, limit, unreadOnly } = req.query;
    const result = await this.notificationService.getMyNotifications(userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === "true",
    });

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Notifications fetched successfully",
      data: result,
    } as ApiResponse);
  });

  markAsRead = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const userId = req.user?._id as unknown as string;
      const notification = await this.notificationService.markAsRead(
        userId,
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Notification marked as read",
        data: { notification },
      } as ApiResponse);
    },
  );

  markAllAsRead = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.notificationService.markAllAsRead(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "All notifications marked as read",
      data: result,
    } as ApiResponse);
  });

  deleteNotification = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const userId = req.user?._id as unknown as string;
      await this.notificationService.deleteNotification(userId, req.params.id);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Notification deleted successfully",
      } as ApiResponse);
    },
  );

  // ── Admin ────────────────────────────────────────────────────────────

  getAdminNotifications = handleAsyncControl(
    async (req: Request, res: Response) => {
      const { page, limit, recipientType, type, recipientUserId } = req.query;
      const result = await this.notificationService.getAdminNotifications({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        recipientType: recipientType as string | undefined,
        type: type as string | undefined,
        recipientUserId: recipientUserId as string | undefined,
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Notifications fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  sendNotification = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          recipientUserId: string;
          recipientType: "customer" | "vendor" | "admin";
          title: string;
          body: string;
        }
      >,
      res: Response,
    ) => {
      const adminUserId = req.user?._id as unknown as string;
      const notification = await this.notificationService.sendManualNotification(
        adminUserId,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "notification.send",
        targetType: "Notification",
        targetId: (notification as any)._id?.toString(),
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Notification sent successfully",
        data: { notification },
      } as ApiResponse);
    },
  );
}
