/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type SupportTicketCategory =
  | "order_issue"
  | "payment_issue"
  | "delivery_issue"
  | "food_quality"
  | "account_issue"
  | "other";
export type SupportTicketPriority = "low" | "medium" | "high" | "critical";
export type SupportTicketStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";
export type SupportTicketSenderType = "customer" | "vendor" | "admin";

export interface SupportTicketMessage {
  senderType: SupportTicketSenderType;
  senderId: mongoose.Types.ObjectId;
  senderName: string;
  message: string;
  createdAt: Date;
}

export interface SupportTicketInternalNote {
  adminUserId: mongoose.Types.ObjectId;
  note: string;
  createdAt: Date;
}

export interface SupportTicketDocument extends Document {
  ticketNumber: string;
  customerId: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  messages: SupportTicketMessage[];
  // Staff-only — never included in customer/vendor-facing responses.
  internalNotes: SupportTicketInternalNote[];
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketMessageSchema = new Schema<SupportTicketMessage>(
  {
    senderType: {
      type: String,
      enum: ["customer", "vendor", "admin"],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const SupportTicketInternalNoteSchema = new Schema<SupportTicketInternalNote>(
  {
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    note: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const SupportTicketSchema = new Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    category: {
      type: String,
      enum: [
        "order_issue",
        "payment_issue",
        "delivery_issue",
        "food_quality",
        "account_issue",
        "other",
      ],
      default: "other",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    messages: {
      type: [SupportTicketMessageSchema],
      required: true,
      default: [],
    },
    internalNotes: {
      type: [SupportTicketInternalNoteSchema],
      required: true,
      default: [],
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    resolvedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<SupportTicketDocument>(
  "SupportTicket",
  SupportTicketSchema,
);
