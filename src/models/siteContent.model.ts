/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface SiteContentDocument extends Document {
  aboutUs: string;
  contactEmail: string;
  contactPhone: string;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Singleton document — there is only ever one SiteContent record, fetched/
// created via SiteContentService.getOrCreateSiteContent(), mirroring
// FinancialSettings's getOrCreateSettings() pattern exactly.
const SiteContentSchema = new Schema(
  {
    aboutUs: {
      type: String,
      required: true,
      default:
        "TheOtherWife is a premier food delivery platform connecting customers with the best local vendors.",
    },
    contactEmail: {
      type: String,
      required: true,
      default: "contact@theotherwife.com",
    },
    contactPhone: {
      type: String,
      required: true,
      default: "+234-800-1234-5678",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

export default model<SiteContentDocument>("SiteContent", SiteContentSchema);
