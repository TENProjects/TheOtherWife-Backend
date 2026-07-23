/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type NotificationRecipientType = "customer" | "vendor" | "admin";
export type NotificationType =
  | "order_update"
  | "vendor_approval"
  | "support_ticket"
  | "payout"
  | "system";

export interface NotificationDocument extends Document {
  recipientUserId: mongoose.Types.ObjectId;
  recipientType: NotificationRecipientType;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  // Generic pointer to whatever triggered this (an Order, SupportTicket,
  // Vendor, etc.) — optional, purely for the client to deep-link with.
  relatedEntityType?: string;
  relatedEntityId?: string;
  // Set only for admin-authored manual notifications; absent for
  // system/signal-generated ones.
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema(
  {
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientType: {
      type: String,
      enum: ["customer", "vendor", "admin"],
      required: true,
    },
    type: {
      type: String,
      enum: [
        "order_update",
        "vendor_approval",
        "support_ticket",
        "payout",
        "system",
      ],
      required: true,
      default: "system",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    isRead: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    relatedEntityType: {
      type: String,
      required: false,
    },
    relatedEntityId: {
      type: String,
      required: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });

export default model<NotificationDocument>("Notification", NotificationSchema);
