/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface CustomerDocument extends Document {
  userId: mongoose.Types.ObjectId;
  addressId: mongoose.Types.ObjectId;
  profileImageUrl: string;
  expoTokens: string[];
  pushNotificationsEnabled: boolean;
  customerGroup: "new" | "regular" | "vip" | "at_risk" | "blocked";
  adminNotes: string;
}

const CustomerSchema = new Schema({
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
  profileImageUrl: {
    type: String,
    required: false,
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
  // Admin-assigned segmentation, set via the admin "Assign Customer Group"
  // action — not derived automatically from order history.
  customerGroup: {
    type: String,
    enum: ["new", "regular", "vip", "at_risk", "blocked"],
    default: "new",
    index: true,
  },
  adminNotes: {
    type: String,
    required: false,
    default: "",
  },
});

export default model<CustomerDocument>("Customer", CustomerSchema);
