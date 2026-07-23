/** @format */

import z from "zod";
import { emailSchema } from "./auth.schema.js";

export const updateSiteContentSchema = z.object({
  aboutUs: z.string().trim().min(1).max(5000).optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: z.string().trim().min(1).max(30).optional(),
});
