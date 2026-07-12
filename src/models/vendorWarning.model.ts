/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface VendorWarningDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  message: string;
  issuedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VendorWarningSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

export default model<VendorWarningDocument>(
  "VendorWarning",
  VendorWarningSchema,
);
