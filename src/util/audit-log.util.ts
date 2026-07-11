/** @format */

import AdminAuditLog from "../models/adminAuditLog.model.js";

interface LogAdminActionParams {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// Fire-and-forget: audit logging must never block or fail the admin action it
// documents. Errors are swallowed (and logged to console) rather than thrown.
export const logAdminAction = (params: LogAdminActionParams): void => {
  AdminAuditLog.create({
    adminUserId: params.adminUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  }).catch((error) => {
    console.error("Failed to write admin audit log:", error);
  });
};
