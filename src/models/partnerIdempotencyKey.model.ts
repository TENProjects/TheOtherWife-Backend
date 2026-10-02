/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Server-side Idempotency-Key store for partner write requests. The unique
// (partnerId, key) index is the lock; the TTL index on expiresAt cleans up.
export interface PartnerIdempotencyKeyDocument extends Document {
  partnerId: mongoose.Types.ObjectId;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  state: "in_progress" | "completed";
  responseStatus?: number;
  responseBody?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerIdempotencyKeySchema = new Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },
    key: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: {
      type: String,
      enum: ["in_progress", "completed"],
      required: true,
      default: "in_progress",
    },
    responseStatus: { type: Number, required: false },
    responseBody: { type: Schema.Types.Mixed, required: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

PartnerIdempotencyKeySchema.index({ partnerId: 1, key: 1 }, { unique: true });
PartnerIdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model<PartnerIdempotencyKeyDocument>(
  "PartnerIdempotencyKey",
  PartnerIdempotencyKeySchema,
);
