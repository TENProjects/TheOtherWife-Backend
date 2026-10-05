/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// A finalized (and later paid) partner settlement. Two kinds:
//  - customer_weekly: one Mon–Sun (WAT) week of the partner's share of TOW
//    earned on attributed customer orders, less allocated platform cost.
//  - homechef_batch: one full batch of successful HomeChefs (by rank).
// Every figure is snapshotted at finalize time so the record stays auditable
// even if orders change later (later refunds become adjustments in the next
// weekly statement). Payment itself happens outside the system; this only
// records that it was made.
export interface PartnerSettlementDocument extends Document {
  publicId: string;
  campaignId: mongoose.Types.ObjectId;
  partnerId?: mongoose.Types.ObjectId;
  type: "customer_weekly" | "homechef_batch";
  periodStart?: Date;
  periodEnd?: Date;
  batchNumber?: number;
  status: "finalized" | "paid";
  currency: string;
  lines: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  // Amount carried into the next weekly statement when the payout would be
  // negative (customer_weekly only).
  carryForward: number;
  finalizedBy: mongoose.Types.ObjectId;
  finalizedAt: Date;
  paidBy?: mongoose.Types.ObjectId;
  paidAt?: Date;
  paymentReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerSettlementSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCampaign",
      required: true,
    },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", required: false },
    type: {
      type: String,
      enum: ["customer_weekly", "homechef_batch"],
      required: true,
    },
    periodStart: { type: Date, required: false },
    periodEnd: { type: Date, required: false },
    batchNumber: { type: Number, required: false, min: 1 },
    status: { type: String, enum: ["finalized", "paid"], default: "finalized" },
    currency: { type: String, required: true, default: "NGN" },
    lines: { type: [Schema.Types.Mixed], default: [] },
    adjustments: { type: [Schema.Types.Mixed], default: [] },
    totals: { type: Schema.Types.Mixed, required: true },
    carryForward: { type: Number, required: true, default: 0 },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    finalizedAt: { type: Date, required: true },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    paidAt: { type: Date, required: false },
    paymentReference: { type: String, required: false, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

// A week or a batch can only ever be finalized once per campaign.
PartnerSettlementSchema.index(
  { campaignId: 1, type: 1, periodStart: 1 },
  { unique: true, partialFilterExpression: { type: "customer_weekly" } },
);
PartnerSettlementSchema.index(
  { campaignId: 1, type: 1, batchNumber: 1 },
  { unique: true, partialFilterExpression: { type: "homechef_batch" } },
);
PartnerSettlementSchema.index({ campaignId: 1, createdAt: -1 });

export default model<PartnerSettlementDocument>(
  "PartnerSettlement",
  PartnerSettlementSchema,
);
