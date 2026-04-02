/** @format */

import z from "zod";

const cloudinaryUrlPattern = /^https:\/\/res\.cloudinary\.com\/[^/]+\/.+$/i;

export const cloudinaryAssetUrlSchema = z
  .url()
  .trim()
  .refine((value) => cloudinaryUrlPattern.test(value), {
    message: "Asset URL must be a Cloudinary URL",
  });

export const cloudinaryUploadAssetTypeSchema = z.enum([
  "vendorDocument",
  "vendorBusinessLogo",
  "mealImage",
  "customerProfileImage",
]);
