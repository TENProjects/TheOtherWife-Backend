/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type HomeChefApplicationStatus =
  | "new"
  | "contacted"
  | "inspection_scheduled"
  | "approved"
  | "rejected";

export interface HomeChefApplicationDocument extends Document {
  applicationNumber: string;
  fullName: string;
  email: string;
  whatsapp: string;
  location: string;
  cuisine: string;
  hygieneCert: string;
  capacity: string;
  socialLink?: string;
  bio: string;
  termsAccepted: boolean;
  status: HomeChefApplicationStatus;
  // Staff-only free text — no threaded notes, this is a lead pipeline, not a
  // conversation.
  adminNotes?: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const HomeChefApplicationSchema = new Schema(
  {
    applicationNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    whatsapp: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    cuisine: { type: String, required: true, trim: true },
    hygieneCert: { type: String, required: true, trim: true },
    capacity: { type: String, required: true, trim: true },
    socialLink: { type: String, required: false, trim: true },
    bio: { type: String, required: true, trim: true, maxlength: 2000 },
    termsAccepted: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ["new", "contacted", "inspection_scheduled", "approved", "rejected"],
      default: "new",
      index: true,
    },
    adminNotes: { type: String, required: false, trim: true, maxlength: 2000 },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    reviewedAt: { type: Date, required: false },
  },
  { timestamps: true },
);

export default model<HomeChefApplicationDocument>(
  "HomeChefApplication",
  HomeChefApplicationSchema,
);
