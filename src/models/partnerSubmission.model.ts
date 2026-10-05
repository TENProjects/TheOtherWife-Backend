/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface PartnerSubmissionEvent {
  type: string;
  at: Date;
  actorType: "partner" | "user" | "admin" | "system";
  actorId?: string;
  data?: Record<string, unknown>;
}

// A lead pre-registered by a partner through the partner API. It is NOT a
// TOW account: the person still signs up through the existing TOW customer
// signup / vendor onboarding flow themselves, and the submission is linked
// to their account when they claim (invite token or matching email). Partners
// can never create or approve TOW users or vendors.
export interface PartnerSubmissionDocument extends Document {
  publicId: string;
  partnerId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  referralCodeId: mongoose.Types.ObjectId;
  type: "homechef" | "customer";
  externalRef: string;
  email: string;
  phoneNumber?: string;
  firstName: string;
  lastName: string;
  state?: string;
  city?: string;
  requestHash: string;
  inviteTokenHash: string;
  linkedUserId?: mongoose.Types.ObjectId;
  attributionId?: mongoose.Types.ObjectId;
  linkedAt?: Date;
  credentialKeyId: string;
  // Last partner-facing status observed by the status-checker job
  // (services/partner-webhook.service.ts). statusSeq increments on every
  // change and is sent as `sequence` in webhooks so partners can order them.
  lastStatus?: string;
  lastStatusChangedAt?: Date;
  statusSeq: number;
  events: PartnerSubmissionEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const PartnerSubmissionEventSchema = new Schema(
  {
    type: { type: String, required: true },
    at: { type: Date, required: true },
    actorType: {
      type: String,
      enum: ["partner", "user", "admin", "system"],
      required: true,
    },
    actorId: { type: String, required: false },
    data: { type: Schema.Types.Mixed, required: false },
  },
  { _id: false },
);

const PartnerSubmissionSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCampaign",
      required: true,
      index: true,
    },
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCode",
      required: true,
    },
    type: { type: String, enum: ["homechef", "customer"], required: true },
    externalRef: { type: String, required: true, trim: true, maxlength: 64 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phoneNumber: { type: String, required: false, trim: true },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: false, trim: true, maxlength: 100 },
    city: { type: String, required: false, trim: true, maxlength: 100 },
    requestHash: { type: String, required: true },
    inviteTokenHash: { type: String, required: true, unique: true, index: true },
    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    attributionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attribution",
      required: false,
    },
    linkedAt: { type: Date, required: false },
    credentialKeyId: { type: String, required: true },
    lastStatus: { type: String, required: false },
    lastStatusChangedAt: { type: Date, required: false },
    statusSeq: { type: Number, required: true, default: 0, min: 0 },
    events: { type: [PartnerSubmissionEventSchema], default: [] },
  },
  { timestamps: true },
);

// Natural-key idempotency: one submission per partner/type/externalRef.
PartnerSubmissionSchema.index(
  { partnerId: 1, type: 1, externalRef: 1 },
  { unique: true },
);
PartnerSubmissionSchema.index({ partnerId: 1, type: 1, email: 1 });
PartnerSubmissionSchema.index({ partnerId: 1, type: 1, updatedAt: 1 });

export default model<PartnerSubmissionDocument>(
  "PartnerSubmission",
  PartnerSubmissionSchema,
);
