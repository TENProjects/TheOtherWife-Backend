/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface VendorCallLogDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  adminUserId: mongoose.Types.ObjectId;
  durationSeconds: number;
  notes?: string;
  calledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VendorCallLogSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    durationSeconds: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      required: false,
      trim: true,
      maxlength: 1000,
    },
    calledAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export default model<VendorCallLogDocument>(
  "VendorCallLog",
  VendorCallLogSchema,
);
