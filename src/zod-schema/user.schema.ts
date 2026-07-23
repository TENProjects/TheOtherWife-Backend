/** @format */

import z from "zod";
import { emailSchema, phoneNumberSchema } from "./auth.schema.js";

export const closeCurrentUserAccountSchema = z.object({
  password: z.string().trim().min(8),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(["active", "suspended", "deleted"]),
  reason: z.string().trim().max(500).optional(),
});

export const createAdminUserSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: emailSchema,
    password: z.string().trim().min(8),
    phoneNumber: phoneNumberSchema,
    // Optional — defaults to "super_admin" in AuthService.signup when
    // omitted, so any existing caller not yet passing this keeps today's
    // behavior (full access) unchanged.
    adminRole: z.enum(["super_admin", "manager", "support_agent"]).optional(),
  })
  .refine((data) => data.email && data.phoneNumber, {
    message: "Email and phone number are required",
    path: ["email", "phoneNumber"],
  });

export const assignCustomerGroupSchema = z.object({
  group: z.string().trim().min(1),
});

export const updateCustomerAdminNotesSchema = z.object({
  adminNotes: z.string().trim().max(2000),
});
