/** @format */

import z from "zod";

export const rejectVendorApplicationSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const sendVendorWarningSchema = z.object({
  message: z.string().trim().min(1).max(1000),
});

export const createVendorIssueSchema = z.object({
  vendorId: z.string().trim().min(1),
  category: z.enum([
    "delivery_delay",
    "food_quality",
    "policy_violation",
    "customer_complaint",
    "other",
  ]),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const resolveVendorIssueSchema = z.object({
  resolutionNotes: z.string().trim().min(1).max(2000),
});

export const sendVendorMessageSchema = z.object({
  vendorId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(2000),
});

export const logVendorCallSchema = z.object({
  vendorId: z.string().trim().min(1),
  durationSeconds: z.number().int().min(0),
  notes: z.string().trim().max(1000).optional(),
});
