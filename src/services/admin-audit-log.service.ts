/** @format */

import AdminAuditLog from "../models/adminAuditLog.model.js";

export class AdminAuditLogService {
  getAuditLogs = async (filters: {
    action?: string;
    targetType?: string;
    adminUserId?: string;
    page?: number;
    limit?: number;
  }) => {
    const query: Record<string, unknown> = {};
    if (filters.action) query.action = filters.action;
    if (filters.targetType) query.targetType = filters.targetType;
    if (filters.adminUserId) query.adminUserId = filters.adminUserId;

    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(query)
        .populate("adminUserId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AdminAuditLog.countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };
}
