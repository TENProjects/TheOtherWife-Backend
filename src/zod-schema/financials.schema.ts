/** @format */

import z from "zod";

export const updatePaymentGatewaySchema = z
  .object({
    isActive: z.boolean().optional(),
    transactionFeePercent: z.number().min(0).max(100).optional(),
  })
  .refine(
    (value) =>
      value.isActive !== undefined || value.transactionFeePercent !== undefined,
    { message: "At least one field is required" },
  );

export const updateCommissionConfigSchema = z
  .object({
    commissionType: z.enum(["percentage", "flat"]),
    commissionRate: z.number().min(0),
  })
  .refine(
    (value) => value.commissionType !== "percentage" || value.commissionRate <= 100,
    {
      message: "A percentage commission rate cannot exceed 100",
      path: ["commissionRate"],
    },
  );

export const updateTaxSettingsSchema = z.object({
  defaultRate: z.number().min(0).max(100),
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        rate: z.number().min(0).max(100),
      }),
    )
    .optional(),
});
