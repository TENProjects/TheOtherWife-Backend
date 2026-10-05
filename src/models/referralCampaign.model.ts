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
  // Commercial rules agreed for this campaign. Optional: a campaign without
  // them is tracked but has no qualification or settlement (internal
  // referrals, plain marketing campaigns). Nothing here is partner-specific.
  rules?: CampaignRules;
  // The HomeChef target window. Opened automatically at the first approval
  // of a campaign HomeChef (rules.homechef.windowDays long); an admin may
  // override both dates.
  windowStartsAt?: Date;
  windowEndsAt?: Date;
  // Atomic rank counter for successful HomeChefs (1-based, gapless).
  qualifiedCount: number;
  // Lease so only one job run assigns qualification ranks at a time.
  qualificationLockUntil?: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type HomechefRules = {
  // The first N HomeChefs to meet the base rule (approved + inspection
  // completed + published menu) qualify on it alone.
  earlyTierSize: number;
  requireInspection: boolean;
  requireMenu: boolean;
  // After the early tier, also this many completed (delivered + paid) orders.
  completedOrdersAfterEarlyTier: number;
  payoutPerHomechef: number;
  settlementBatchSize: number;
  // Only the first N successful HomeChefs (by rank) are payable.
  payableCap: number;
  windowDays: number;
};

export type CustomerRules = {
  // Partner share of TOW's earned amount on attributed paid orders.
  revenueSharePercent: number;
  // Deduct a share of platform infrastructure cost (PlatformCost) from it.
  deductPlatformCost: boolean;
};

export type ActiveRules = {
  minCompletedOrdersPerWeek: number;
  internalTargetPerWeek: number;
};

export type CampaignRules = {
  homechef?: HomechefRules;
  customer?: CustomerRules;
  active?: ActiveRules;
};

const HomechefRulesSchema = new Schema(
  {
    earlyTierSize: { type: Number, required: true, min: 0, max: 100000 },
    requireInspection: { type: Boolean, required: true, default: true },
    requireMenu: { type: Boolean, required: true, default: true },
    completedOrdersAfterEarlyTier: { type: Number, required: true, min: 0, max: 1000 },
    payoutPerHomechef: { type: Number, required: true, min: 0 },
    settlementBatchSize: { type: Number, required: true, min: 1, max: 10000 },
    payableCap: { type: Number, required: true, min: 0 },
    windowDays: { type: Number, required: true, min: 1, max: 3650 },
  },
  { _id: false },
);

const CustomerRulesSchema = new Schema(
  {
    revenueSharePercent: { type: Number, required: true, min: 0, max: 100 },
    deductPlatformCost: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const ActiveRulesSchema = new Schema(
  {
    minCompletedOrdersPerWeek: { type: Number, required: true, min: 1, max: 1000 },
    internalTargetPerWeek: { type: Number, required: true, min: 1, max: 1000 },
  },
  { _id: false },
);

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
    rules: {
      type: new Schema(
        {
          homechef: { type: HomechefRulesSchema, required: false },
          customer: { type: CustomerRulesSchema, required: false },
          active: { type: ActiveRulesSchema, required: false },
        },
        { _id: false },
      ),
      required: false,
    },
    windowStartsAt: { type: Date, required: false },
    windowEndsAt: { type: Date, required: false },
    qualifiedCount: { type: Number, required: true, default: 0, min: 0 },
    qualificationLockUntil: { type: Date, required: false },
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
