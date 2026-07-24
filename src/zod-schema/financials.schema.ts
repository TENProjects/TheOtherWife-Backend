/** @format */

import z from "zod";

export const updatePaymentGatewaySchema = z
  .object({
    isActive: z.boolean().optional(),
    transactionFeePercent: z.number().min(0).max(100).optional(),
    publicKey: z.string().trim().max(200).optional(),
    secretKey: z.string().trim().max(200).optional(),
  })
  .refine(
    (value) =>
      value.isActive !== undefined ||
      value.transactionFeePercent !== undefined ||
      value.publicKey !== undefined ||
      value.secretKey !== undefined,
    { message: "At least one field is required" },
  );

export const testPaymentGatewayConnectionSchema = z.object({
  secretKey: z.string().trim().min(1),
});

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

// `confirm` must be literally `true` — mirrors the spec's required second
// confirmation step before VAT can be enabled.
export const updateVatSettingsSchema = z.object({
  enabled: z.boolean(),
  confirm: z.literal(true),
});

export const updateSystemSettingsSchema = z
  .object({
    refundAutoApprovalThreshold: z.number().min(0).optional(),
    orderDelayThresholdMinutes: z.number().min(1).optional(),
    minimumWithdrawalAmount: z.number().min(0).optional(),
  })
  .refine(
    (value) =>
      value.refundAutoApprovalThreshold !== undefined ||
      value.orderDelayThresholdMinutes !== undefined ||
      value.minimumWithdrawalAmount !== undefined,
    { message: "At least one field is required" },
  );
