/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import { defaultVendorOpeningHours } from "../util/vendor-opening-hours.util.js";
import type { VendorOpeningHours } from "../util/vendor-opening-hours.util.js";

export interface VendorPayoutSettings {
  autoPayoutEnabled: boolean;
  schedule: "daily" | "weekly" | "biweekly" | "monthly";
  minimumAmount: number;
  defaultMethod: "bank" | "card";
  bankDetails?: {
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
  };
}

export interface VendorDocument extends Document {
  userId: mongoose.Types.ObjectId;
  addressId: mongoose.Types.ObjectId;
  businessName: string;
  businessDescription: string;
  businessLogoUrl: string;
  approvalStatus: string;
  // Paystack Split Payment (Financial & Commission Spec v1.0, section 3.2) —
  // created automatically once the vendor has both been approved AND saved
  // bank details. Vendors without one simply fall back to the manual
  // VendorPayoutRequest flow rather than being blocked from checkout.
  paystackSubaccountCode?: string;
  // Set whenever automatic subaccount creation throws (e.g. unrecognized
  // bank name); cleared on the next successful attempt. Lets admins see
  // which vendors are stuck on manual payouts and why, without digging
  // through server logs.
  paystackSubaccountError?: string;
  paystackSubaccountErrorAt?: Date;
  // Admin-tracked manual verification/inspection progress, separate from
  // approvalStatus — tracks whether an admin has reviewed the vendor's
  // submitted documents/business, independent of the approve/reject decision.
  inspectionStatus: "not_started" | "in_progress" | "completed";
  isAvailable: boolean;
  openingHours: VendorOpeningHours;
  payoutSettings: VendorPayoutSettings;
  approvedBy: mongoose.Types.ObjectId;
  approvedAt: Date;
  rejectionReason: string;
  ratingAverage: number;
  ratingCount: number;
  ratingScore: number;
  expoTokens: string[];
  pushNotificationsEnabled: boolean;
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
  paystackSubaccountCode: {
    type: String,
    required: false,
  },
  paystackSubaccountError: {
    type: String,
    required: false,
  },
  paystackSubaccountErrorAt: {
    type: Date,
    required: false,
  },
  approvalStatus: {
    type: String,
    enum: ["pending", "approved", "suspended", "rejected"],
    default: "pending",
  },
  inspectionStatus: {
    type: String,
    enum: ["not_started", "in_progress", "completed"],
    default: "not_started",
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
  payoutSettings: {
    type: {
      autoPayoutEnabled: { type: Boolean, required: true, default: true },
      schedule: {
        type: String,
        enum: ["daily", "weekly", "biweekly", "monthly"],
        required: true,
        default: "daily",
      },
      minimumAmount: { type: Number, required: true, default: 0, min: 0 },
      defaultMethod: {
        type: String,
        enum: ["bank", "card"],
        required: true,
        default: "bank",
      },
      bankDetails: {
        type: {
          bankName: { type: String, required: false },
          accountName: { type: String, required: false },
          accountNumber: { type: String, required: false },
        },
        required: false,
        _id: false,
      },
    },
    required: true,
    default: () => ({
      autoPayoutEnabled: true,
      schedule: "daily",
      minimumAmount: 0,
      defaultMethod: "bank",
    }),
    _id: false,
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
  expoTokens: {
    type: [String],
    required: true,
    default: [],
  },
  pushNotificationsEnabled: {
    type: Boolean,
    required: true,
    default: true,
  },
  additionalData: {
    type: Object,
    required: false,
  },
});

export default model<VendorDocument>("Vendor", VendorSchema);
