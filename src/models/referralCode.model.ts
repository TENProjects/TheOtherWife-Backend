/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// The attribution identifier handed to people (in a link, on a flyer, by a
// partner's UI). NOT a credential: knowing a code only lets someone attribute
// their own newly created account to the code's campaign. Partner API access
// is controlled exclusively by PartnerCredential.
export interface ReferralCodeDocument extends Document {
  code: string;
  campaignId: mongoose.Types.ObjectId;
  // Set only for internal user-to-user referral codes.
  ownerUserId?: mongoose.Types.ObjectId;
  audience: "vendor" | "customer" | "both";
  status: "active" | "disabled";
  expiresAt?: Date;
  maxUses?: number;
  // Informational counter of successful attributions — reporting always
  // counts Attribution documents, never trusts this number.
  usedCount: number;
  label?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralCodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCampaign",
      required: true,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    audience: {
      type: String,
      enum: ["vendor", "customer", "both"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    expiresAt: { type: Date, required: false },
    maxUses: { type: Number, required: false, min: 1 },
    usedCount: { type: Number, required: true, default: 0, min: 0 },
    label: { type: String, required: false, trim: true, maxlength: 200 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export default model<ReferralCodeDocument>("ReferralCode", ReferralCodeSchema);
