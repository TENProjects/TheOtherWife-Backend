/** @format */

import z from "zod";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const frequencySchema = z.enum([
  "daily",
  "weekdays",
  "weekends",
  "custom",
]);

export const portionSizeSchema = z.enum(["small", "regular", "large"]);

export const paymentTypeSchema = z.enum(["weekly", "monthly", "per_meal"]);

export const timeWindowSchema = z.object({
  startTime: z.string().regex(timeRegex, "startTime must be in HH:mm format"),
  endTime: z.string().regex(timeRegex, "endTime must be in HH:mm format"),
});

export const customizationSchema = z.object({
  portionSize: portionSizeSchema,
  note: z.string().trim().max(500).optional(),
});

export const createMealPlanSchema = z
  .object({
    name: z.string().trim().min(1),
    addressId: z.string().trim().min(1),
    frequency: frequencySchema,
    customDays: z.array(z.string().trim().min(1)).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    deliveryTimeWindow: timeWindowSchema,
    defaultCustomization: customizationSchema,
    paymentType: paymentTypeSchema,
  })
  .refine((value) => value.endDate.getTime() > value.startDate.getTime(), {
    message: "endDate must be after startDate",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.frequency !== "custom" ||
      (value.customDays && value.customDays.length > 0),
    {
      message: "customDays is required when frequency is 'custom'",
      path: ["customDays"],
    },
  );

export const updateMealPlanSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    addressId: z.string().trim().min(1).optional(),
    frequency: frequencySchema.optional(),
    customDays: z.array(z.string().trim().min(1)).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    deliveryTimeWindow: timeWindowSchema.optional(),
    defaultCustomization: customizationSchema.optional(),
    paymentType: paymentTypeSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );

export const addMealToPlanSchema = z.object({
  mealId: z.string().trim().min(1),
  customization: customizationSchema.optional(),
});

export const updateScheduledMealSchema = z
  .object({
    deliveryDate: z.coerce.date().optional(),
    deliveryTimeWindow: timeWindowSchema.optional(),
    customization: customizationSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );
