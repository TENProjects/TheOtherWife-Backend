/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface PaymentDocument extends Document {
  // Only one of orderId/mealPlanId is set, matching `context`. orderId
  // remains required for the default ("order") context — see the schema
  // definition below; it's typed optional here only to accommodate the
  // meal_plan context.
  orderId?: mongoose.Types.ObjectId;
  mealPlanId?: mongoose.Types.ObjectId;
  context: "order" | "meal_plan";
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
  // Vendor clawback ledger total applied against this payment (Financial &
  // Commission Spec v1.0, section 4.1 — Scenario A automatic refund).
  vendorClawbackAmount: number;
  // Paystack's cut (1.5% + N100, capped at N2000) — absorbed entirely by TOW,
  // never the vendor. Stored for admin net-profit reporting (section 3.3/7.1).
  paystackFeeAmount: number;
  // True when this payment was initialized with a Paystack subaccount split
  // (section 3.2) — the vendor's 80% cut was deposited directly to their own
  // bank account by Paystack at charge time, bypassing the manual
  // VendorPayoutRequest flow entirely for this payment.
  splitPayment: boolean;
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
      // Only required for the default "order" context — meal-plan payments
      // (context: "meal_plan") reference mealPlanId instead.
      required: function (this: { context?: string }) {
        return this.context !== "meal_plan";
      },
      index: true,
    },
    mealPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MealPlan",
      required: false,
      index: true,
    },
    context: {
      type: String,
      enum: ["order", "meal_plan"],
      required: true,
      default: "order",
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
    vendorClawbackAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    paystackFeeAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    splitPayment: {
      type: Boolean,
      required: true,
      default: false,
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
