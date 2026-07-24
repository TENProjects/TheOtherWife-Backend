/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface PaymentGatewayConfig {
  key: string;
  name: string;
  transactionFeePercent: number;
  isActive: boolean;
  publicKey?: string;
  secretKey?: string;
}

export interface TaxCategoryConfig {
  name: string;
  rate: number;
}

export interface FinancialSettingsDocument extends Document {
  commissionType: "percentage" | "flat";
  commissionRate: number;
  paymentGateways: PaymentGatewayConfig[];
  taxDefaultRate: number;
  taxCategories: TaxCategoryConfig[];
  // VAT-on-processing-fee toggle (TheOtherWife Financial & Commission Spec
  // v1.0, section 2.3) — OFF by default until FIRS registration is confirmed.
  // Tracked separately from `updatedBy` with its own audit trail (who/when)
  // per the spec's compliance requirement.
  vatEnabled: boolean;
  vatToggledAt?: Date;
  vatToggledBy?: mongoose.Types.ObjectId;
  // System Control (Super Admin) settings — grouped here since this is
  // already the app's one settings singleton, rather than a second one.
  refundAutoApprovalThreshold: number;
  orderDelayThresholdMinutes: number;
  minimumWithdrawalAmount: number;
  updatedBy?: mongoose.Types.ObjectId;
}

// Singleton document — there is only ever one FinancialSettings record,
// fetched/created via FinancialsService.getOrCreateSettings().
const FinancialSettingsSchema = new Schema(
  {
    commissionType: {
      type: String,
      enum: ["percentage", "flat"],
      default: "percentage",
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
    },
    // NOTE: only "paystack" has a real payment integration (see
    // payment.service.ts / Payment.provider enum). Flutterwave/Stripe
    // entries here are admin-facing configuration only — toggling
    // isActive does NOT enable real payment processing for them.
    paymentGateways: {
      type: [
        {
          key: { type: String, required: true },
          name: { type: String, required: true },
          transactionFeePercent: { type: Number, required: true, min: 0 },
          isActive: { type: Boolean, required: true, default: false },
          publicKey: { type: String, required: false },
          secretKey: { type: String, required: false },
          _id: false,
        },
      ],
      default: [
        { key: "paystack", name: "Paystack", transactionFeePercent: 1.5, isActive: true },
        { key: "flutterwave", name: "Flutterwave", transactionFeePercent: 1.4, isActive: false },
        { key: "stripe", name: "Stripe", transactionFeePercent: 2.9, isActive: false },
      ],
    },
    taxDefaultRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 7.5,
    },
    taxCategories: {
      type: [
        {
          name: { type: String, required: true },
          rate: { type: Number, required: true, min: 0, max: 100 },
          _id: false,
        },
      ],
      default: [
        { name: "Food & Beverages", rate: 7.5 },
        { name: "Delivery Fee", rate: 7.5 },
      ],
    },
    vatEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },
    vatToggledAt: {
      type: Date,
      required: false,
    },
    vatToggledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Displayed as guidance on the refund decision screen — does not
    // automatically approve refund requests, since no request-creation flow
    // in this codebase is wired to check it yet.
    refundAutoApprovalThreshold: {
      type: Number,
      required: true,
      min: 0,
      default: 5000,
    },
    // Used by OrderService.getPlatformPerformanceMetrics to derive the
    // "Delays" count.
    orderDelayThresholdMinutes: {
      type: Number,
      required: true,
      min: 1,
      default: 60,
    },
    // Enforced in VendorWalletService.requestVendorPayout.
    minimumWithdrawalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 10000,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

export default model<FinancialSettingsDocument>(
  "FinancialSettings",
  FinancialSettingsSchema,
);
