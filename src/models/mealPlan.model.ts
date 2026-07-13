/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface MealPlanCustomization {
  portionSize: "small" | "regular" | "large";
  note?: string;
}

export interface MealPlanTimeWindow {
  startTime: string;
  endTime: string;
}

export interface MealPlanDocument extends Document {
  customerId: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  // Every scheduled meal in this plan delivers here — captured once at plan
  // creation rather than resolved from the customer's "default" address at
  // fulfillment time, so a later address change elsewhere doesn't silently
  // redirect an in-progress plan's deliveries.
  addressId: mongoose.Types.ObjectId;
  name: string;
  frequency: "daily" | "weekdays" | "weekends" | "custom";
  customDays?: string[];
  startDate: Date;
  endDate: Date;
  deliveryTimeWindow: MealPlanTimeWindow;
  defaultCustomization: MealPlanCustomization;
  paymentType: "weekly" | "monthly" | "per_meal";
  status: "active" | "cancelled";
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

const MealPlanTimeWindowSchema = new Schema(
  {
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
  },
  { _id: false },
);

const MealPlanCustomizationSchema = new Schema(
  {
    portionSize: {
      type: String,
      enum: ["small", "regular", "large"],
      required: true,
    },
    note: {
      type: String,
      required: false,
      maxlength: 500,
    },
  },
  { _id: false },
);

const MealPlanSchema = new Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
    },
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    frequency: {
      type: String,
      enum: ["daily", "weekdays", "weekends", "custom"],
      required: true,
    },
    customDays: {
      type: [String],
      default: undefined,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    deliveryTimeWindow: {
      type: MealPlanTimeWindowSchema,
      required: true,
    },
    defaultCustomization: {
      type: MealPlanCustomizationSchema,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["weekly", "monthly", "per_meal"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      required: true,
      default: "active",
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
  },
  { timestamps: true },
);

export default model<MealPlanDocument>("MealPlan", MealPlanSchema);
