/** @format */

import z from "zod";

export const createPromoCodeSchema = z
  .object({
    code: z.string().trim().min(3).max(30),
    discountType: z.enum(["fixed", "percentage"]),
    discountValue: z.number().positive(),
    expiresAt: z.coerce.date().optional(),
    maxUses: z.number().int().min(1).optional(),
    minOrderValue: z.number().min(0).optional(),
  })
  .refine(
    (value) => value.discountType !== "percentage" || value.discountValue <= 100,
    { message: "A percentage discount cannot exceed 100", path: ["discountValue"] },
  );

export const updatePromoCodeSchema = z
  .object({
    isActive: z.boolean().optional(),
    discountValue: z.number().positive().optional(),
    expiresAt: z.coerce.date().optional(),
    maxUses: z.number().int().min(1).optional(),
    minOrderValue: z.number().min(0).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: "At least one field is required" },
  );
