/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type ReferralProgramType = "internal_user" | "partner" | "campaign";
export type ReferralAudience = "vendor" | "customer";

// A time-boxed acquisition programme. Every referral code belongs to exactly
// one campaign; a partner arrangement is just a campaign with
// programType "partner" and a partnerId.
export interface ReferralCampaignDocument extends Document {
  name: string;
  description?: string;
  programType: ReferralProgramType;
  partnerId?: mongoose.Types.ObjectId;
  status: "draft" | "active" | "paused" | "ended";
  startsAt: Date;
  endsAt?: Date;
  audiences: ReferralAudience[];
  // How long a customer's orders stay attributable after attribution.
  customerAttributionDays: number;
  // Only accounts created within this many days before the claim (and not
  // before the campaign started) can be attributed — existing TOW users are
  // never retro-attributed.
  claimWindowDays: number;
  targets: {
    homechefs?: number;
    customers?: number;
  };
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: false, trim: true, maxlength: 2000 },
    programType: {
      type: String,
      enum: ["internal_user", "partner", "campaign"],
      required: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: false,
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "ended"],
      default: "draft",
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: false },
    audiences: {
      type: [{ type: String, enum: ["vendor", "customer"] }],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: "At least one audience is required",
      },
    },
    customerAttributionDays: {
      type: Number,
      required: true,
      default: 90,
      min: 1,
      max: 3650,
    },
    claimWindowDays: {
      type: Number,
      required: true,
      default: 7,
      min: 0,
      max: 365,
    },
    targets: {
      type: {
        homechefs: { type: Number, required: false, min: 0 },
        customers: { type: Number, required: false, min: 0 },
      },
      required: false,
      default: {},
      _id: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

ReferralCampaignSchema.index({ partnerId: 1, status: 1 });

export default model<ReferralCampaignDocument>(
  "ReferralCampaign",
  ReferralCampaignSchema,
);
