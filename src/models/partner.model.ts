/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// An external organisation TOW has an approved acquisition arrangement with
// (e.g. FoodClime / Peace Sustainability). Partners are pure data — nothing
// in the attribution core is specific to any one partner.
export interface PartnerDocument extends Document {
  name: string;
  slug: string;
  status: "active" | "suspended";
  contactEmail?: string;
  notes?: string;
  // Outbound status webhooks. The signing secret is stored encrypted
  // (util/secret-box.util.ts) and never returned after it is first issued.
  webhook?: {
    url?: string;
    secretCiphertext?: string;
    enabled: boolean;
    updatedAt?: Date;
  };
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      match: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
    contactEmail: { type: String, required: false, trim: true, lowercase: true },
    notes: { type: String, required: false, trim: true, maxlength: 2000 },
    webhook: {
      url: { type: String, required: false, trim: true },
      secretCiphertext: { type: String, required: false, select: false },
      enabled: { type: Boolean, default: false },
      updatedAt: { type: Date, required: false },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export default model<PartnerDocument>("Partner", PartnerSchema);
