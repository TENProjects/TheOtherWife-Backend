/** @format */

import z from "zod";
import { emailSchema, phoneNumberSchema } from "./auth.schema.js";

const nonEmptyString = z.string().trim().min(1);
const parseStringArrayField = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return [];
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

const strictTrueFromFormSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return value;
}, z.literal(true));

const cloudinaryDocumentTypeSchema = z.enum([
  "governmentId",
  "businessCertificate",
  "displayImage",
]);

export const vendorOnboardingUploadSignatureSchema = z.object({
  documentType: cloudinaryDocumentTypeSchema,
});

export const vendorOnboardingStep1Schema = z
  .object({
    firstName: nonEmptyString,
    lastName: nonEmptyString,
    email: emailSchema,
    phoneNumber: phoneNumberSchema,
    password: z.string().trim().min(8),
    confirmPassword: z.string().trim().min(8),
    state: nonEmptyString,
    city: nonEmptyString,
    address: z.string().trim().optional(),
    socials: z
      .object({
        instagram: z.string().trim().optional(),
        facebook: z.string().trim().optional(),
        twitter: z.string().trim().optional(),
      })
      .optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const vendorOnboardingStep2Schema = z.object({
  businessName: nonEmptyString,
  businessDescription: z.string().trim().optional(),
  businessLogoUrl: z.string().trim().optional(),
  yearsOfExperience: z.coerce.number().int().min(0),
  cuisines: z.preprocess(parseStringArrayField, z.array(nonEmptyString).min(1)),
  bankName: nonEmptyString,
  accountNumber: z.string().trim().regex(/^\d{10,}$/),
  accountName: z.string().trim().optional(),
});

const onboardingDocumentSchema = z.object({
  fileUrl: z.url().trim(),
  fileName: nonEmptyString.optional(),
  mimeType: nonEmptyString.optional(),
  publicId: nonEmptyString,
  resourceType: nonEmptyString.optional(),
});

export const vendorOnboardingStep3Schema = z.object({
  governmentId: z.preprocess(parseJsonObject, onboardingDocumentSchema),
  businessCertificate: z.preprocess(parseJsonObject, onboardingDocumentSchema),
  displayImage: z.preprocess(parseJsonObject, onboardingDocumentSchema),
  confirmedAccuracy: strictTrueFromFormSchema,
  acceptedTerms: strictTrueFromFormSchema,
  acceptedVerification: strictTrueFromFormSchema,
});

// Post-onboarding "fix a missing document" endpoint — unlike step 3, every
// document is optional here (a vendor may only be filling in the one that
// failed to upload), but at least one must be present.
export const vendorOnboardingUpdateDocumentsSchema = z
  .object({
    governmentId: z.preprocess(parseJsonObject, onboardingDocumentSchema.optional()),
    businessCertificate: z.preprocess(parseJsonObject, onboardingDocumentSchema.optional()),
    displayImage: z.preprocess(parseJsonObject, onboardingDocumentSchema.optional()),
  })
  .refine(
    (data) => data.governmentId || data.businessCertificate || data.displayImage,
    { message: "At least one document must be provided" },
  );
