/** @format */

import z from "zod";

const objectIdString = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

export const sendNotificationSchema = z.object({
  recipientUserId: objectIdString,
  recipientType: z.enum(["customer", "vendor", "admin"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
});
