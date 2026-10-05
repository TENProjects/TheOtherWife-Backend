/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Monthly platform infrastructure cost (e.g. hosting), entered by an admin.
// Used to allocate a share of cost to partner customer settlements: per-day
// cost × the partner's share of TOW earned in the period. An explicit 0 is a
// valid entry; a missing month blocks finalizing a statement that touches it.
export interface PlatformCostDocument extends Document {
  month: string; // "YYYY-MM"
  amount: number;
  currency: string;
  note?: string;
  updatedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformCostSchema = new Schema(
  {
    month: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    note: { type: String, required: false, trim: true, maxlength: 500 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export default model<PlatformCostDocument>("PlatformCost", PlatformCostSchema);
