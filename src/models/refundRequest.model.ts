/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type RefundRequestStatus = "pending" | "approved" | "rejected";

export interface RefundRequestDocument extends Document {
  orderId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  amount: number;
  reason: string;
  status: RefundRequestStatus;
  adminNotes?: string;
  decidedBy?: mongoose.Types.ObjectId;
  decidedAt?: Date;
}

const RefundRequestSchema = new Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
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
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    adminNotes: {
      type: String,
      required: false,
      trim: true,
      maxlength: 1000,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    decidedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<RefundRequestDocument>(
  "RefundRequest",
  RefundRequestSchema,
);
