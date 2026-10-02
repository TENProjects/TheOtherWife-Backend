/** @format */

import z from "zod";
import { emailSchema, phoneNumberSchema } from "./auth.schema.js";

export const externalRefSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._-]{1,64}$/,
    "externalRef must be 1-64 chars: letters, digits, '.', '_' or '-'",
  );

// Strict: unknown fields are rejected rather than silently stored.
export const partnerSubmissionSchema = z.strictObject({
  externalRef: externalRefSchema,
  campaignCode: z.string().trim().min(4).max(32),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema,
  phoneNumber: phoneNumberSchema.optional(),
  state: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
});

export const partnerListQuerySchema = z.object({
  updatedSince: z.coerce.date().optional(),
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
