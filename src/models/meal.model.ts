/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface MealOption {
  _id?: mongoose.Types.ObjectId;
  name: string;
  price: number;
}

export interface MealDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  name: string;
  categoryName: string;
  description: string;
  price: number;
  imageUrl: string;
  isAvailable: boolean;
  publicationStatus: "draft" | "published";
  primaryImageUrl: string;
  additionalImages: Array<string>;
  tags: Array<string>;
  preparationTime: number;
  servingSize: string;
  additionalData: string;
  preparationType?: "freshly_cooked" | "cook_and_freeze" | "both";
  availability: "daily" | "weekly" | "custom";
  availabilitySchedule?: Array<string>;
  availabilityNote?: string;
  packagingOptions: Array<MealOption>;
  proteinOptions: Array<MealOption>;
  drinksOptions: Array<MealOption>;
  addOns: Array<MealOption>;
  ratingAverage: number;
  ratingCount: number;
  ratingScore: number;
  isDeleted: boolean;
}

const MealOptionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
);

const MealSchema = new Schema({
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vendor",
    required: true,
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MealCategory",
  },
  name: {
    type: String,
    required: true,
  },
  categoryName: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  isAvailable: {
    type: Boolean,
    default: false,
  },
  publicationStatus: {
    type: String,
    enum: ["draft", "published"],
    required: true,
    default: "draft",
  },
  primaryImageUrl: {
    type: String,
    required: true,
  },
  additionalImages: {
    type: [String],
  },
  tags: {
    type: [String],
    required: true,
    default: [],
  },
  preparationTime: {
    type: Number,
  },
  servingSize: {
    type: String,
  },
  additionalData: {
    type: String,
    required: false,
  },
  preparationType: {
    type: String,
    enum: ["freshly_cooked", "cook_and_freeze", "both"],
    required: false,
  },
  availability: {
    type: String,
    enum: ["daily", "weekly", "custom"],
    required: true,
    default: "daily",
  },
  availabilitySchedule: {
    type: [String],
    default: undefined,
  },
  availabilityNote: {
    type: String,
    required: false,
  },
  packagingOptions: {
    type: [MealOptionSchema],
    required: true,
    default: [],
  },
  proteinOptions: {
    type: [MealOptionSchema],
    required: true,
    default: [],
  },
  drinksOptions: {
    type: [MealOptionSchema],
    required: true,
    default: [],
  },
  addOns: {
    type: [MealOptionSchema],
    required: true,
    default: [],
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
  isDeleted: {
    type: Boolean,
    required: true,
    default: false,
  },
});

export default model<MealDocument>("Meal", MealSchema);
