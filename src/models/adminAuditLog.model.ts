/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface AdminAuditLogDocument extends Document {
  adminUserId: mongoose.Types.ObjectId;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const AdminAuditLogSchema = new Schema(
  {
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // e.g. "vendor.approve", "vendor.reject", "vendor.suspend",
    // "user.status_update", "admin.create", "payout.update"
    action: {
      type: String,
      required: true,
      index: true,
    },
    // e.g. "Vendor", "User", "VendorPayoutRequest"
    targetType: {
      type: String,
      required: true,
    },
    targetId: {
      type: String,
      required: false,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false,
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export default model<AdminAuditLogDocument>(
  "AdminAuditLog",
  AdminAuditLogSchema,
);
