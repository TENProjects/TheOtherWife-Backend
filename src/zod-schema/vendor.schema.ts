/** @format */

import z from "zod";
import { cloudinaryAssetUrlSchema } from "./cloudinary.schema.js";

export const updateVendorProfileSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    phoneNumber: z.string().trim().optional(),
    businessName: z.string().trim().optional(),
    businessDescription: z.string().trim().optional(),
    businessLogoUrl: cloudinaryAssetUrlSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one field is required",
    },
  );
