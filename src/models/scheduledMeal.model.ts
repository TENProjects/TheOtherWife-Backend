/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import type {
  MealPlanCustomization,
  MealPlanTimeWindow,
} from "./mealPlan.model.js";

export interface ScheduledMealDocument extends Document {
  planId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  mealId: mongoose.Types.ObjectId;
  mealName: string;
  mealImageUrl?: string;
  price: number;
  deliveryDate: Date;
  deliveryTimeWindow: MealPlanTimeWindow;
  customization: MealPlanCustomization;
  status: "scheduled" | "cancelled" | "completed";
  cancelledAt?: Date;
  paymentStatus: "pending" | "succeeded" | "failed";
  paymentId?: mongoose.Types.ObjectId;
  // Set once this scheduled meal is converted into a real vendor-facing
  // Order (see MealPlanFulfillmentService) — presence of this field is what
  // prevents converting the same scheduled meal twice.
  orderId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledMealTimeWindowSchema = new Schema(
  {
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
  },
  { _id: false },
);

const ScheduledMealCustomizationSchema = new Schema(
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

const ScheduledMealSchema = new Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MealPlan",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    mealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
      required: true,
    },
    mealName: {
      type: String,
      required: true,
    },
    mealImageUrl: {
      type: String,
      required: false,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryDate: {
      type: Date,
      required: true,
    },
    deliveryTimeWindow: {
      type: ScheduledMealTimeWindowSchema,
      required: true,
    },
    customization: {
      type: ScheduledMealCustomizationSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "cancelled", "completed"],
      required: true,
      default: "scheduled",
    },
    cancelledAt: {
      type: Date,
      required: false,
    },
    // Paid upfront in the batch that created this scheduled meal (see
    // MealPlanService.addMealToPlan) — mirrors the linked Payment's status
    // rather than duplicating payment logic here.
    paymentStatus: {
      type: String,
      enum: ["pending", "succeeded", "failed"],
      required: true,
      default: "pending",
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: false,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
    },
  },
  { timestamps: true },
);

ScheduledMealSchema.index({ planId: 1, deliveryDate: 1 });
ScheduledMealSchema.index({ customerId: 1, status: 1, deliveryDate: 1 });

export default model<ScheduledMealDocument>(
  "ScheduledMeal",
  ScheduledMealSchema,
);
