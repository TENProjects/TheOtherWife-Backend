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
  // Optional — a ticket originates from either a customer (customerId set)
  // or a vendor (vendorId set as the raiser, no customerId). vendorId alone
  // is ambiguous between these two cases; see messages[0].senderType to
  // disambiguate who actually opened the ticket.
  customerId?: mongoose.Types.ObjectId;
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
  // Realtime chat delivery/typing indicators can't rely on a persistent
  // WebSocket connection (the API runs on Vercel serverless functions,
  // which can't hold one open — see src/realtime/socket.ts), so clients
  // poll instead. Each field is set to "now + a few seconds" whenever that
  // party is actively typing, and read back by the other party's poll as
  // `fieldValue > now`, so it clears itself without needing a matching
  // "stopped typing" call.
  typingUntil?: {
    customer?: Date;
    vendor?: Date;
    admin?: Date;
  };
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
      required: false,
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
    typingUntil: {
      type: {
        customer: { type: Date, required: false },
        vendor: { type: Date, required: false },
        admin: { type: Date, required: false },
      },
      required: false,
      default: () => ({}),
      _id: false,
    },
  },
  { timestamps: true },
);

export default model<SupportTicketDocument>(
  "SupportTicket",
  SupportTicketSchema,
);
