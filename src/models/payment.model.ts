/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface PaymentDocument extends Document {
  orderId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  provider: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  vendorGrossAmount: number;
  vendorPlatformFeeAmount: number;
  vendorNetAmount: number;
  vendorSettledAmount: number;
  settlementStatus: string;
  settlementEligibleAt?: Date;
  providerTransactionId?: string;
  accessCode?: string;
  authorizationUrl?: string;
  providerPayload?: Record<string, unknown>;
  paidAt?: Date;
}

const PaymentSchema = new Schema(
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
    provider: {
      type: String,
      enum: ["paystack", "cash", "wallet"],
      required: true,
      default: "paystack",
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
    status: {
      type: String,
      enum: [
        "initialized",
        "pending",
        "pending_customer_action",
        "processing",
        "succeeded",
        "failed",
        "expired",
        "cancelled",
        "refunded",
      ],
      required: true,
      default: "initialized",
    },
    vendorGrossAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vendorPlatformFeeAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vendorNetAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vendorSettledAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    settlementStatus: {
      type: String,
      enum: ["ineligible", "unsettled", "partially_paid", "paid", "reversed"],
      required: true,
      default: "ineligible",
      index: true,
    },
    settlementEligibleAt: {
      type: Date,
      required: false,
    },
    providerTransactionId: {
      type: String,
      required: false,
    },
    accessCode: {
      type: String,
      required: false,
    },
    authorizationUrl: {
      type: String,
      required: false,
    },
    providerPayload: {
      type: Schema.Types.Mixed,
      required: false,
    },
    paidAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<PaymentDocument>("Payment", PaymentSchema);
