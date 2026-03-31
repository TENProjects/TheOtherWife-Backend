/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface MealReviewDocument extends Document {
  mealId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MealReviewSchema = new Schema(
  {
    mealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Meal",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: false,
      trim: true,
    },
  },
  { timestamps: true },
);

MealReviewSchema.index(
  { orderId: 1, customerId: 1, mealId: 1 },
  { unique: true },
);

export default model<MealReviewDocument>("MealReview", MealReviewSchema);
