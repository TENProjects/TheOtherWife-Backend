/** @format */

import z from "zod";
import { cloudinaryAssetUrlSchema } from "./cloudinary.schema.js";

export const createMealReviewSchema = z.object({
  orderId: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const createMealSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  price: z.number().positive(),
  categoryName: z.string().trim().min(1),
  availableFrom: z.string().trim().min(1),
  availableUntil: z.string().trim().min(1),
  primaryImageUrl: cloudinaryAssetUrlSchema,
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const updateMealSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    price: z.number().positive().optional(),
    categoryName: z.string().trim().min(1).optional(),
    availableFrom: z.string().trim().min(1).optional(),
    availableUntil: z.string().trim().min(1).optional(),
    primaryImageUrl: cloudinaryAssetUrlSchema.optional(),
    additionalImages: z.array(cloudinaryAssetUrlSchema).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    preparationTime: z.number().int().min(0).optional(),
    servingSize: z.string().trim().min(1).optional(),
    additionalData: z.string().trim().optional(),
    isAvailable: z.enum(["pending", "available", "unavailable"]).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );
