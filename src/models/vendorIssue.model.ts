/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type VendorIssueCategory =
  | "delivery_delay"
  | "food_quality"
  | "policy_violation"
  | "customer_complaint"
  | "other";
export type VendorIssuePriority = "low" | "medium" | "high" | "critical";
export type VendorIssueStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "escalated";

export interface VendorIssueDocument extends Document {
  vendorId: mongoose.Types.ObjectId;
  category: VendorIssueCategory;
  title: string;
  description: string;
  priority: VendorIssuePriority;
  status: VendorIssueStatus;
  resolutionNotes?: string;
  createdBy: mongoose.Types.ObjectId;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  escalatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VendorIssueSchema = new Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "delivery_delay",
        "food_quality",
        "policy_violation",
        "customer_complaint",
        "other",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "escalated"],
      default: "open",
      index: true,
    },
    resolutionNotes: {
      type: String,
      required: false,
      trim: true,
      maxlength: 2000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    resolvedAt: {
      type: Date,
      required: false,
    },
    escalatedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<VendorIssueDocument>("VendorIssue", VendorIssueSchema);
