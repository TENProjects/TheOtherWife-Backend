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
    phoneNumber: phoneNumberSchema.optional(),
  });

export const loginUserSchema = z.object({
  email: emailSchema,
  password: z.string().trim().min(8),
});

export const googleLoginSchema = z.object({
  idToken: z.string().trim().min(1),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1),
    newPassword: z.string().trim().min(8),
    confirmNewPassword: z.string().trim().min(8),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().trim().min(8),
    newPassword: z.string().trim().min(8),
    confirmNewPassword: z.string().trim().min(8),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });
