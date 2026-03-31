/** @format */

import z from "zod";
import { emailSchema, phoneNumberSchema } from "./auth.schema.js";

const nonEmptyString = z.string().trim().min(1);
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
  yearsOfExperience: z.number().int().min(0),
  cuisines: z.array(nonEmptyString).min(1),
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
  governmentId: onboardingDocumentSchema,
  businessCertificate: onboardingDocumentSchema,
  displayImage: onboardingDocumentSchema,
  confirmedAccuracy: z.literal(true),
  acceptedTerms: z.literal(true),
  acceptedVerification: z.literal(true),
});
