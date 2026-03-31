/** @format */

import z from "zod";

export const updateCurrentCustomerProfileSchema = z
  .object({
    profileImageUrl: z.string().trim().optional(),
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    email: z.email().trim().optional(),
    phoneNumber: z.string().trim().optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some(
        (field) => field !== undefined && field !== null && field !== "",
      ),
    {
      message: "At least one field is required",
    },
  );
