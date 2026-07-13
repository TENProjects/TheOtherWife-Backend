/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Customer-facing, checkout-time discount code (Financial & Commission Spec
// v1.0, section 5.1) — TOW issues these, customer redeems by entering the
// code at checkout. Distinct from PromoCampaign (an unrelated, automatic
// post-payment cashback-to-wallet reward with no customer-entered code).
export type PromoCodeDiscountType = "fixed" | "percentage";

export interface PromoCodeDocument extends Document {
  code: string;
  discountType: PromoCodeDiscountType;
  discountValue: number;
  isActive: boolean;
  expiresAt?: Date;
  maxUses?: number;
  usedCount: number;
  minOrderValue: number;
  createdBy?: mongoose.Types.ObjectId;
}

const PromoCodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    discountType: {
      type: String,
      enum: ["fixed", "percentage"],
      required: true,
    },
    // For "fixed": an NGN amount. For "percentage": 0-100.
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    maxUses: {
      type: Number,
      required: false,
      min: 1,
    },
    usedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    minOrderValue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

export default model<PromoCodeDocument>("PromoCode", PromoCodeSchema);
