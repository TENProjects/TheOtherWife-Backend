/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type VendorMessageSenderType = "admin" | "vendor";

export interface VendorMessageDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  senderType: VendorMessageSenderType;
  senderId: mongoose.Types.ObjectId;
  message: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VendorMessageSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ["admin", "vendor"],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    isRead: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true },
);

export default model<VendorMessageDocument>(
  "VendorMessage",
  VendorMessageSchema,
);
