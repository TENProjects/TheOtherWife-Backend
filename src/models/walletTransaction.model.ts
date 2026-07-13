/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface WalletTransactionDocument extends Document {
  walletId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletType: "promo";
  transactionType:
    | "promo_earn"
    | "promo_spend"
    | "promo_reverse"
    | "promo_expire"
    | "refund_credit";
  amount: number;
  currency: string;
  status: "pending" | "posted" | "reversed";
  referenceType: "order" | "campaign" | "system";
  referenceId: string;
  promoCampaignId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
}

const WalletTransactionSchema = new Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    walletType: {
      type: String,
      enum: ["promo"],
      required: true,
      default: "promo",
    },
    transactionType: {
      type: String,
      enum: ["promo_earn", "promo_spend", "promo_reverse", "promo_expire", "refund_credit"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["pending", "posted", "reversed"],
      required: true,
      default: "pending",
    },
    referenceType: {
      type: String,
      enum: ["order", "campaign", "system"],
      required: true,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      index: true,
    },
    promoCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCampaign",
      required: false,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false,
    },
  },
  { timestamps: true },
);

WalletTransactionSchema.index(
  {
    userId: 1,
    transactionType: 1,
    referenceType: 1,
    referenceId: 1,
    promoCampaignId: 1,
  },
  { unique: true },
);

WalletTransactionSchema.index(
  {
    userId: 1,
    transactionType: 1,
    promoCampaignId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "promo_earn",
      promoCampaignId: { $exists: true },
    },
  },
);

export default model<WalletTransactionDocument>(
  "WalletTransaction",
  WalletTransactionSchema,
);
