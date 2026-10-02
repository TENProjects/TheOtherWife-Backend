/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type AttributionActorType = "user" | "partner" | "admin" | "system";

export interface AttributionEvent {
  type: string;
  at: Date;
  actorType: AttributionActorType;
  actorId?: string;
  data?: Record<string, unknown>;
}

// "Where did this TOW user come from?" — one document per attributed user
// (first-touch, enforced by the unique subjectUserId index). This is pure
// metadata: nothing here is ever written back onto User, Vendor, Order,
// Payment or Wallet. Order attribution is derived at query time from
// Order.customerId + Order.createdAt against [attributedAt, expiresAt).
export interface AttributionDocument extends Document {
  subjectUserId: mongoose.Types.ObjectId;
  subjectType: "vendor" | "customer";
  vendorId?: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  partnerId?: mongoose.Types.ObjectId;
  referralCodeId: mongoose.Types.ObjectId;
  codeSnapshot: string;
  programType: "internal_user" | "partner" | "campaign";
  referrerUserId?: mongoose.Types.ObjectId;
  channel: "link" | "partner_invite" | "admin";
  partnerSubmissionId?: mongoose.Types.ObjectId;
  externalRef?: string;
  attributedAt: Date;
  // Customers only — end of the order-attribution window. Absent = no expiry.
  expiresAt?: Date;
  status: "active" | "revoked";
  // Vendors only — audit snapshot of the first time the existing
  // vendor.approved signal fired for this vendor after attribution (or the
  // vendor's approvedAt if already approved at claim time). Live Vendor state
  // remains the source of truth for reporting.
  firstApprovedAt?: Date;
  // Who caused this attribution to be recorded.
  actorType: AttributionActorType;
  actorId?: string;
  events: AttributionEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const AttributionEventSchema = new Schema(
  {
    type: { type: String, required: true },
    at: { type: Date, required: true },
    actorType: {
      type: String,
      enum: ["user", "partner", "admin", "system"],
      required: true,
    },
    actorId: { type: String, required: false },
    data: { type: Schema.Types.Mixed, required: false },
  },
  { _id: false },
);

const AttributionSchema = new Schema(
  {
    subjectUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    subjectType: {
      type: String,
      enum: ["vendor", "customer"],
      required: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCampaign",
      required: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: false,
    },
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCode",
      required: true,
    },
    codeSnapshot: { type: String, required: true },
    programType: {
      type: String,
      enum: ["internal_user", "partner", "campaign"],
      required: true,
    },
    referrerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    channel: {
      type: String,
      enum: ["link", "partner_invite", "admin"],
      required: true,
    },
    partnerSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PartnerSubmission",
      required: false,
    },
    externalRef: { type: String, required: false },
    attributedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: false },
    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
    },
    firstApprovedAt: { type: Date, required: false },
    actorType: {
      type: String,
      enum: ["user", "partner", "admin", "system"],
      required: true,
    },
    actorId: { type: String, required: false },
    events: { type: [AttributionEventSchema], default: [] },
  },
  { timestamps: true },
);

AttributionSchema.index({ campaignId: 1, subjectType: 1, attributedAt: 1 });
AttributionSchema.index({ partnerId: 1, subjectType: 1 });

export default model<AttributionDocument>("Attribution", AttributionSchema);
