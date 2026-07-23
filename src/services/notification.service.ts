/** @format */

import Notification, {
  NotificationRecipientType,
  NotificationType,
} from "../models/notification.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

type Pagination = { page?: number; limit?: number };

const paginate = ({ page = 1, limit = 20 }: Pagination) => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};

export class NotificationService {
  // Called internally by signal handlers / other services — never exposed
  // directly as a public write endpoint (the admin "send" endpoint below
  // wraps it with its own auth/logging).
  create = async (payload: {
    recipientUserId: string;
    recipientType: NotificationRecipientType;
    type: NotificationType;
    title: string;
    body: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    createdBy?: string;
  }) => {
    return Notification.create(payload);
  };

  getMyNotifications = async (
    userId: string,
    filters: Pagination & { unreadOnly?: boolean },
  ) => {
    const { safeLimit, safePage, skip } = paginate(filters);

    const query: Record<string, unknown> = { recipientUserId: userId };
    if (filters.unreadOnly) query.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipientUserId: userId, isRead: false }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  markAsRead = async (userId: string, notificationId: string) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipientUserId: userId },
      { $set: { isRead: true } },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException(
        "Notification not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return notification;
  };

  markAllAsRead = async (userId: string) => {
    const result = await Notification.updateMany(
      { recipientUserId: userId, isRead: false },
      { $set: { isRead: true } },
    );
    return { updatedCount: result.modifiedCount };
  };

  deleteNotification = async (userId: string, notificationId: string) => {
    const result = await Notification.deleteOne({
      _id: notificationId,
      recipientUserId: userId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException(
        "Notification not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { deleted: true };
  };

  // ── Admin ────────────────────────────────────────────────────────────

  getAdminNotifications = async (
    filters: Pagination & {
      recipientType?: string;
      type?: string;
      recipientUserId?: string;
    },
  ) => {
    const { safeLimit, safePage, skip } = paginate(filters);

    const query: Record<string, unknown> = {};
    if (filters.recipientType) query.recipientType = filters.recipientType;
    if (filters.type) query.type = filters.type;
    if (filters.recipientUserId) query.recipientUserId = filters.recipientUserId;

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate("recipientUserId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Notification.countDocuments(query),
    ]);

    return {
      notifications,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  sendManualNotification = async (
    adminUserId: string,
    payload: {
      recipientUserId: string;
      recipientType: NotificationRecipientType;
      title: string;
      body: string;
    },
  ) => {
    return this.create({
      ...payload,
      type: "system",
      createdBy: adminUserId,
    });
  };
}
