/** @format */

import z from "zod";

export const createRefundRequestSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().trim().min(1).max(1000),
});

export const decideRefundRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  adminNotes: z.string().trim().max(1000).optional(),
});
