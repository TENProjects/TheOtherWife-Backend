/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type VendorPayoutRequestStatus =
  | "requested"
  | "processing"
  | "approved"
  | "rejected";
export type VendorPayoutRequestPaymentStatus = "unpaid" | "paid";

// Automatic payout through Paystack Transfers.
//   pending      sent to Paystack, waiting for the bank's answer
//   success      the bank was credited (the request is then paid)
//   failed       not credited; nothing was deducted — retry or pay manually
//   reversed     credited, then returned by the bank; the vendor's balance is restored
//   needs_review Paystack reported something that doesn't match what we sent;
//                money state left untouched until a person checks it
export type PayoutTransferStatus =
  | "pending"
  | "success"
  | "failed"
  | "reversed"
  | "needs_review";

export interface PayoutTransfer {
  status: PayoutTransferStatus;
  // Our reference for the current attempt (unique per attempt).
  reference: string;
  previousReferences: string[];
  attempts: number;
  amount: number;
  transferCode?: string;
  recipientCode?: string;
  bankCode?: string;
  accountNumber?: string;
  // The name the bank returned for the account — what was actually paid.
  verifiedAccountName?: string;
  initiatedBy?: mongoose.Types.ObjectId;
  initiatedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
}

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
  transfer?: PayoutTransfer;
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
    transfer: {
      type: {
        status: {
          type: String,
          enum: ["pending", "success", "failed", "reversed", "needs_review"],
          required: true,
        },
        reference: { type: String, required: true },
        previousReferences: { type: [String], default: [] },
        attempts: { type: Number, default: 0, min: 0 },
        amount: { type: Number, required: true, min: 0 },
        transferCode: { type: String, required: false },
        recipientCode: { type: String, required: false },
        bankCode: { type: String, required: false },
        accountNumber: { type: String, required: false },
        verifiedAccountName: { type: String, required: false },
        initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
        initiatedAt: { type: Date, required: false },
        completedAt: { type: Date, required: false },
        failureReason: { type: String, required: false, maxlength: 500 },
      },
      required: false,
      _id: false,
    },
  },
  { timestamps: true },
);

// A Paystack reference identifies exactly one payout attempt.
VendorPayoutRequestSchema.index({ "transfer.reference": 1 }, { unique: true, sparse: true });
VendorPayoutRequestSchema.index({ "transfer.previousReferences": 1 });
VendorPayoutRequestSchema.index({ "transfer.status": 1, "transfer.initiatedAt": 1 });

export default model<VendorPayoutRequestDocument>(
  "VendorPayoutRequest",
  VendorPayoutRequestSchema,
);
