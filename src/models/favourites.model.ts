/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface FavouritesDocument extends Document {
  customerId: mongoose.Types.ObjectId;
  favouriteMeals: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const FavouritesSchema = new Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },
    favouriteMeals: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Meal",
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

export default model<FavouritesDocument>("Favourites", FavouritesSchema);
