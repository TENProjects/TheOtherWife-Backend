/** @format */

import z from "zod";
import { cloudinaryAssetUrlSchema } from "./cloudinary.schema.js";

const parseJsonObject = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const timeStringSchema = z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

const dailyOpeningHoursSchema = z.object({
  isOpen: z.coerce.boolean(),
  openTime: timeStringSchema,
  closeTime: timeStringSchema,
});

const openingHoursSchema = z.object({
  monday: dailyOpeningHoursSchema,
  tuesday: dailyOpeningHoursSchema,
  wednesday: dailyOpeningHoursSchema,
  thursday: dailyOpeningHoursSchema,
  friday: dailyOpeningHoursSchema,
  saturday: dailyOpeningHoursSchema,
  sunday: dailyOpeningHoursSchema,
});

export const updateVendorProfileSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    phoneNumber: z.string().trim().optional(),
    businessName: z.string().trim().optional(),
    businessDescription: z.string().trim().optional(),
    businessLogoUrl: cloudinaryAssetUrlSchema.optional(),
    expoTokens: z.preprocess(parseJsonObject, z.array(z.string().trim())).optional(),
    pushNotificationsEnabled: z.coerce.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );

export const updateVendorInspectionStatusSchema = z.object({
  inspectionStatus: z.enum(["not_started", "in_progress", "completed"]),
});

export const updateVendorAvailabilitySchema = z
  .object({
    isAvailable: z.coerce.boolean().optional(),
    openingHours: z.preprocess(parseJsonObject, openingHoursSchema).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );

const payoutBankDetailsSchema = z.object({
  bankName: z.string().trim().min(1).optional(),
  accountName: z.string().trim().min(1).optional(),
  accountNumber: z.string().trim().min(1).optional(),
});

export const updateVendorPayoutSettingsSchema = z
  .object({
    autoPayoutEnabled: z.coerce.boolean().optional(),
    schedule: z.enum(["daily", "weekly", "biweekly", "monthly"]).optional(),
    minimumAmount: z.coerce.number().min(0).optional(),
    defaultMethod: z.enum(["bank", "card"]).optional(),
    bankDetails: z.preprocess(parseJsonObject, payoutBankDetailsSchema).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );
