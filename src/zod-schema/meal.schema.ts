/** @format */

import z from "zod";
import { cloudinaryAssetUrlSchema } from "./cloudinary.schema.js";

const parseStringArrayField = (
  value: unknown,
): string[] | undefined | unknown => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return [trimmed];
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const nonEmptyStringArraySchema = z.array(z.string().trim().min(1));

export const createMealReviewSchema = z.object({
  orderId: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const createMealSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  price: z.coerce.number().positive(),
  categoryName: z.string().trim().min(1),
  primaryImageUrl: cloudinaryAssetUrlSchema.optional(),
  tags: z.preprocess(parseStringArrayField, nonEmptyStringArraySchema).default([]),
  publicationStatus: z.enum(["draft", "published"]).optional(),
});

export const updateMealSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    price: z.coerce.number().positive().optional(),
    categoryName: z.string().trim().min(1).optional(),
    primaryImageUrl: cloudinaryAssetUrlSchema.optional(),
    additionalImages: z
      .preprocess(parseStringArrayField, z.array(cloudinaryAssetUrlSchema))
      .optional(),
    tags: z.preprocess(parseStringArrayField, nonEmptyStringArraySchema).optional(),
    preparationTime: z.coerce.number().int().min(0).optional(),
    servingSize: z.string().trim().min(1).optional(),
    additionalData: z.string().trim().optional(),
    isAvailable: z.coerce.boolean().optional(),
    publicationStatus: z.enum(["draft", "published"]).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );
