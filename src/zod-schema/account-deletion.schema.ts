/** @format */

import z from "zod";
import { emailSchema } from "./auth.schema.js";

export const requestAccountDeletionSchema = z.object({
  email: emailSchema,
  deletionType: z.enum(["full", "erase_activity"]),
});

export const verifyAccountDeletionSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const confirmAccountDeletionSchema = z.object({
  deletionToken: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});
