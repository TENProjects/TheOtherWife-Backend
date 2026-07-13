/** @format */

import z from "zod";
import { cloudinaryAssetUrlSchema } from "./cloudinary.schema.js";
import { phoneNumberSchema } from "./auth.schema.js";

const parseJsonArray = (value: unknown) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
};

export const updateCurrentCustomerProfileSchema = z
  .object({
    profileImageUrl: cloudinaryAssetUrlSchema.optional(),
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    email: z.email().trim().optional(),
    phoneNumber: phoneNumberSchema.optional(),
    expoTokens: z.preprocess(parseJsonArray, z.array(z.string().trim())).optional(),
    pushNotificationsEnabled: z.coerce.boolean().optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some(
        (field) => field !== undefined && field !== null && field !== "",
      ),
    {
      message: "At least one field is required",
    },
  );
