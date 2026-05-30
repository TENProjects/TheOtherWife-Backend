/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type VendorPayoutRequestStatus =
  | "requested"
  | "processing"
  | "approved"
  | "rejected";
export type VendorPayoutRequestPaymentStatus = "unpaid" | "paid";

export interface VendorPayoutRequestDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  requestedAmount: number;
  approvedAmount: number;
  currency: string;
  status: VendorPayoutRequestStatus;
  paymentStatus: VendorPayoutRequestPaymentStatus;
  bankDetailsSnapshot?: {
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
  };
  note?: string;
  payoutReference?: string;
  approvedBy?: mongoose.Types.ObjectId;
  processedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  paidAt?: Date;
  rejectionReason?: string;
}

const VendorPayoutRequestSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    requestedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    approvedAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["requested", "processing", "approved", "rejected"],
      default: "requested",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
      index: true,
    },
    bankDetailsSnapshot: {
      type: {
        bankName: { type: String, required: false },
        accountName: { type: String, required: false },
        accountNumber: { type: String, required: false },
      },
      required: false,
      _id: false,
    },
    note: {
      type: String,
      required: false,
      trim: true,
      maxlength: 500,
    },
    payoutReference: {
      type: String,
      required: false,
      trim: true,
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    approvedAt: {
      type: Date,
      required: false,
    },
    paidAt: {
      type: Date,
      required: false,
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true },
);

export default model<VendorPayoutRequestDocument>(
  "VendorPayoutRequest",
  VendorPayoutRequestSchema,
);
