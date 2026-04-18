/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import { defaultVendorOpeningHours } from "../util/vendor-opening-hours.util.js";
import type { VendorOpeningHours } from "../util/vendor-opening-hours.util.js";

export interface VendorDocument extends Document {
  userId: mongoose.Types.ObjectId;
  addressId: mongoose.Types.ObjectId;
  businessName: string;
  businessDescription: string;
  businessLogoUrl: string;
  approvalStatus: string;
  isAvailable: boolean;
  openingHours: VendorOpeningHours;
  approvedBy: mongoose.Types.ObjectId;
  approvedAt: Date;
  rejectionReason: string;
  ratingAverage: number;
  ratingCount: number;
  ratingScore: number;
  additionalData: Object;
}

const DailyOpeningHoursSchema = new Schema(
  {
    isOpen: {
      type: Boolean,
      required: true,
      default: true,
    },
    openTime: {
      type: String,
      required: true,
      default: "00:00",
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    closeTime: {
      type: String,
      required: true,
      default: "23:59",
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
  },
  { _id: false },
);

const OpeningHoursSchema = new Schema(
  {
    monday: { type: DailyOpeningHoursSchema, required: true },
    tuesday: { type: DailyOpeningHoursSchema, required: true },
    wednesday: { type: DailyOpeningHoursSchema, required: true },
    thursday: { type: DailyOpeningHoursSchema, required: true },
    friday: { type: DailyOpeningHoursSchema, required: true },
    saturday: { type: DailyOpeningHoursSchema, required: true },
    sunday: { type: DailyOpeningHoursSchema, required: true },
  },
  { _id: false },
);

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
  isAvailable: {
    type: Boolean,
    default: true,
  },
  openingHours: {
    type: OpeningHoursSchema,
    required: true,
    default: () => JSON.parse(JSON.stringify(defaultVendorOpeningHours)),
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
