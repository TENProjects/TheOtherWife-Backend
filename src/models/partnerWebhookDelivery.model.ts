/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Outbox for partner status webhooks. One document per (submission, status
// sequence) — the unique index makes event creation idempotent even if two
// status-checker runs overlap. Retried with backoff until delivered or failed.
export interface PartnerWebhookDeliveryDocument extends Document {
  eventId: string;
  partnerId: mongoose.Types.ObjectId;
  submissionId: mongoose.Types.ObjectId;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt?: Date;
  lastResponseStatus?: number;
  lastError?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerWebhookDeliverySchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PartnerSubmission",
      required: true,
    },
    sequence: { type: Number, required: true, min: 1 },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "delivered", "failed", "cancelled"],
      default: "pending",
    },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, required: false },
    lastResponseStatus: { type: Number, required: false },
    lastError: { type: String, required: false, maxlength: 500 },
    deliveredAt: { type: Date, required: false },
  },
  { timestamps: true },
);

PartnerWebhookDeliverySchema.index({ submissionId: 1, sequence: 1 }, { unique: true });
PartnerWebhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
PartnerWebhookDeliverySchema.index({ partnerId: 1, createdAt: -1 });

export default model<PartnerWebhookDeliveryDocument>(
  "PartnerWebhookDelivery",
  PartnerWebhookDeliverySchema,
);
