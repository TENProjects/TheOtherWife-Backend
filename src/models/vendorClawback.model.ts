/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Financial & Commission Spec v1.0, section 4.1 dev note — when a vendor's
// available balance can't cover an automatic Scenario A clawback in full,
// the shortfall is logged here as "pending" and deducted from their next
// payout automatically (see VendorWalletService.requestVendorPayout).
export type VendorClawbackStatus = "applied" | "pending";

export interface VendorClawbackDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  amount: number;
  appliedAmount: number;
  status: VendorClawbackStatus;
  reason: string;
}

const VendorClawbackSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    appliedAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["applied", "pending"],
      default: "pending",
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

export default model<VendorClawbackDocument>(
  "VendorClawback",
  VendorClawbackSchema,
);
