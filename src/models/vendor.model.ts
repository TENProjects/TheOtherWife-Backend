/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface VendorDocument extends Document {
  userId: mongoose.Types.ObjectId;
  addressId: mongoose.Types.ObjectId;
  businessName: string;
  businessDescription: string;
  businessLogoUrl: string;
  approvalStatus: string;
  approvedBy: mongoose.Types.ObjectId;
  approvedAt: Date;
  rejectionReason: string;
  ratingAverage: number;
  ratingCount: number;
  ratingScore: number;
  additionalData: Object;
}

const VendorSchema = new Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    index: true,
    required: true,
  },
  addressId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Address",
    required: false,
  },
  businessName: {
    type: String,
    required: false,
  },
  businessDescription: {
    type: String,
    required: false,
  },
  businessLogoUrl: {
    type: String,
    required: false,
  },
  approvalStatus: {
    type: String,
    enum: ["pending", "approved", "suspended", "rejected"],
    default: "pending",
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  approvedAt: {
    type: Date,
    required: false,
  },
  rejectionReason: {
    type: String,
    required: false,
  },
  ratingAverage: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  ratingCount: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  ratingScore: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  additionalData: {
    type: Object,
    required: false,
  },
});

export default model<VendorDocument>("Vendor", VendorSchema);
