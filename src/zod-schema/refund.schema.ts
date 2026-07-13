/** @format */

import z from "zod";

export const createRefundRequestSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().trim().min(1).max(1000),
});

// Section 4.2 — approving a Scenario B dispute refund requires the admin to
// enter a mandatory reason/note and an explicit second confirmation. Reject
// decisions don't move money, so neither is required there.
export const decideRefundRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    approvedAmount: z.number().positive().optional(),
    adminNotes: z.string().trim().max(1000).optional(),
    confirm: z.boolean().optional(),
  })
  .refine(
    (value) => value.decision !== "approve" || !!value.adminNotes?.trim(),
    { message: "adminNotes is required when approving a refund", path: ["adminNotes"] },
  )
  .refine((value) => value.decision !== "approve" || value.confirm === true, {
    message: "confirm must be true when approving a refund",
    path: ["confirm"],
  });
