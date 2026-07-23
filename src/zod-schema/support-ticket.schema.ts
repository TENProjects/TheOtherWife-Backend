/** @format */

import z from "zod";

const nonEmptyString = z.string().trim().min(1);
const objectIdString = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

export const createSupportTicketSchema = z.object({
  subject: nonEmptyString.max(200),
  category: z
    .enum([
      "order_issue",
      "payment_issue",
      "delivery_issue",
      "food_quality",
      "account_issue",
      "other",
    ])
    .optional(),
  message: nonEmptyString.max(2000),
  orderId: objectIdString.optional(),
});

export const replyToSupportTicketSchema = z.object({
  message: nonEmptyString.max(2000),
});

export const updateSupportTicketStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const addSupportTicketNoteSchema = z.object({
  note: nonEmptyString.max(2000),
});
