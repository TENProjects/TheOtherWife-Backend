/** @format */

import z from "zod";

export const emailSchema = z.email().trim().max(255);
export const phoneNumberSchema = z.string().min(5).max(20);

export const registerUserSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: emailSchema,
    password: z.string().trim().min(8),
    userType: z.enum(["customer", "vendor"]),
    phoneNumber: phoneNumberSchema,
  })
  .refine((data) => data.email && data.phoneNumber, {
    message: "Email and phone number are required",
    path: ["email", "phoneNumber"],
  });

export const loginUserSchema = z
  .object({
    email: emailSchema.optional(),
    phoneNumber: phoneNumberSchema.optional(),
    password: z.string().trim().min(8),
  })
  .refine((data) => data.email || data.phoneNumber, {
    message: "Email or phone number is required",
    path: ["email", "phoneNumber"],
  });
