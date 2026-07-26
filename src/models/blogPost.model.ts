/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export type BlogPostStatus = "draft" | "published" | "archived";

export interface BlogPostDocument extends Document {
  title: string;
  slug: string;
  // Shown as the category pill on the public blog (theotherwife.com/blog) —
  // free text rather than an enum since the website has no fixed taxonomy.
  category: string;
  featuredImageUrl?: string;
  content: string;
  quote?: string;
  status: BlogPostStatus;
  authorId: mongoose.Types.ObjectId;
  views: number;
  publishedAt?: Date;
}

const BlogPostSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      default: "Food & Culture",
    },
    featuredImageUrl: {
      type: String,
      required: false,
    },
    content: {
      type: String,
      required: true,
    },
    quote: {
      type: String,
      required: false,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    views: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<BlogPostDocument>("BlogPost", BlogPostSchema);
