/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Every scope a partner credential can ever hold. There is deliberately no
// wildcard — each partner route requires one specific scope.
export const PARTNER_SCOPES = [
  "partner:read",
  "homechef:submit",
  "homechef:read",
  "customer:submit",
  "customer:read",
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];

// Machine credential for the partner API. Only the SHA-256 of the secret is
// stored; the full key is returned once at issue time. Entirely separate from
// TOW user authentication (cookie JWT) and from referral codes.
export interface PartnerCredentialDocument extends Document {
  partnerId: mongoose.Types.ObjectId;
  keyId: string;
  secretHash: string;
  label?: string;
  scopes: PartnerScope[];
  status: "active" | "revoked";
  expiresAt?: Date;
  ipAllowlist: string[];
  lastUsedAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  revokedBy?: mongoose.Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCredentialSchema = new Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },
    keyId: { type: String, required: true, unique: true, index: true },
    secretHash: { type: String, required: true, select: false },
    label: { type: String, required: false, trim: true, maxlength: 200 },
    scopes: {
      type: [{ type: String, enum: PARTNER_SCOPES }],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: "At least one scope is required",
      },
    },
    status: { type: String, enum: ["active", "revoked"], default: "active" },
    expiresAt: { type: Date, required: false },
    ipAllowlist: { type: [String], default: [] },
    lastUsedAt: { type: Date, required: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    revokedAt: { type: Date, required: false },
  },
  { timestamps: true },
);

PartnerCredentialSchema.index({ partnerId: 1, status: 1 });

export default model<PartnerCredentialDocument>(
  "PartnerCredential",
  PartnerCredentialSchema,
);
