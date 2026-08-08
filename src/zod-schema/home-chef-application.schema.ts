/** @format */

import z from "zod";

const nonEmptyString = z.string().trim().min(1);

export const createHomeChefApplicationSchema = z.object({
  fullName: nonEmptyString.max(200),
  email: z.string().trim().toLowerCase().email(),
  whatsapp: nonEmptyString.max(30),
  location: nonEmptyString.max(200),
  cuisine: nonEmptyString.max(200),
  hygieneCert: nonEmptyString.max(200),
  capacity: nonEmptyString.max(100),
  socialLink: z.string().trim().max(500).optional(),
  bio: nonEmptyString.max(2000),
  termsAccepted: z.literal(true),
});

export const updateHomeChefApplicationStatusSchema = z.object({
  status: z
    .enum(["new", "contacted", "inspection_scheduled", "approved", "rejected"])
    .optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});
