/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import type { MealCustomization } from "../util/meal-customization.util.js";

export interface CartDocument extends Document {
  customerId: mongoose.Types.ObjectId;
  meals: {
    mealId: mongoose.Types.ObjectId;
    price: number;
    quantity: number;
    totalPrice: number;
    effectiveUnitPrice?: number;
    customization?: MealCustomization;
  }[];
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CartCustomizationSchema = new Schema(
  {
    packaging: {
      name: { type: String },
      price: { type: Number },
    },
    spiceLevel: {
      type: String,
      enum: ["mild", "medium", "hot", "extra"],
    },
    proteinSelections: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
      },
    ],
    addOnSelections: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],
    drinkSelections: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
      },
    ],
    customProteinRequests: {
      type: [String],
      default: undefined,
    },
    customAddOnRequests: {
      type: [String],
      default: undefined,
    },
    customDrinkRequests: {
      type: [String],
      default: undefined,
    },
    cookingInstructions: {
      presets: {
        type: [String],
        default: undefined,
      },
      note: {
        type: String,
        maxlength: 500,
      },
    },
  },
  { _id: false },
);

const CartSchema = new Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },
    meals: [
      {
        mealId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Meal",
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        totalPrice: {
          type: Number,
          required: true,
        },
        effectiveUnitPrice: {
          type: Number,
          required: false,
        },
        customization: {
          type: CartCustomizationSchema,
          required: false,
          default: undefined,
        },
      },
    ],
    totalAmount: {
      type: Number,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<CartDocument>("Cart", CartSchema);
