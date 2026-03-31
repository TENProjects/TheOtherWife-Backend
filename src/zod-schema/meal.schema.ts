/** @format */

import z from "zod";

export const createMealReviewSchema = z.object({
  orderId: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const updateMealSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    price: z.number().positive().optional(),
    categoryName: z.string().trim().min(1).optional(),
    availableFrom: z.string().trim().min(1).optional(),
    availableUntil: z.string().trim().min(1).optional(),
    primaryImageUrl: z.string().trim().min(1).optional(),
    additionalImages: z.array(z.string().trim().min(1)).optional(),
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
