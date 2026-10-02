/** @format */

import z from "zod";
import { PARTNER_SCOPES } from "../models/partnerCredential.model.js";

const objectId = z.string().trim().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const isoDate = z.coerce.date();

// ── User-facing ─────────────────────────────────────────────────────────

export const claimReferralSchema = z
  .strictObject({
    code: z.string().trim().min(4).max(32).optional(),
    inviteToken: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invite token")
      .optional(),
  })
  .refine((data) => !!data.code !== !!data.inviteToken, {
    message: "Provide exactly one of code or inviteToken",
  });

// ── Admin: partners ─────────────────────────────────────────────────────

export const createPartnerSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
      "slug must be lowercase letters, digits and hyphens",
    ),
  contactEmail: z.email().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updatePartnerSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  contactEmail: z.email().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// ── Admin: campaigns ────────────────────────────────────────────────────

const audiences = z.array(z.enum(["vendor", "customer"])).min(1).max(2);
const targets = z.strictObject({
  homechefs: z.number().int().min(0).optional(),
  customers: z.number().int().min(0).optional(),
});

export const createCampaignSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  programType: z.enum(["internal_user", "partner", "campaign"]),
  partnerId: objectId.optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  startsAt: isoDate,
  endsAt: isoDate.optional(),
  audiences,
  customerAttributionDays: z.number().int().min(1).max(3650).optional(),
  claimWindowDays: z.number().int().min(0).max(365).optional(),
  targets: targets.optional(),
});

export const updateCampaignSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  startsAt: isoDate.optional(),
  endsAt: isoDate.nullable().optional(),
  audiences: audiences.optional(),
  customerAttributionDays: z.number().int().min(1).max(3650).optional(),
  claimWindowDays: z.number().int().min(0).max(365).optional(),
  targets: targets.optional(),
});

// ── Admin: codes ────────────────────────────────────────────────────────

export const createReferralCodeSchema = z.strictObject({
  code: z.string().trim().min(4).max(32).optional(),
  audience: z.enum(["vendor", "customer", "both"]),
  expiresAt: isoDate.optional(),
  maxUses: z.number().int().min(1).optional(),
  ownerUserId: objectId.optional(),
  label: z.string().trim().max(200).optional(),
});

export const updateReferralCodeSchema = z.strictObject({
  status: z.enum(["active", "disabled"]).optional(),
  expiresAt: isoDate.nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  label: z.string().trim().max(200).optional(),
});

// ── Admin: partner credentials ──────────────────────────────────────────

export const issuePartnerCredentialSchema = z.strictObject({
  scopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
  label: z.string().trim().max(200).optional(),
  expiresAt: isoDate.optional(),
  ipAllowlist: z.array(z.union([z.ipv4(), z.ipv6()])).max(20).optional(),
});

// ── Admin: query strings ────────────────────────────────────────────────

export const listAttributionsQuerySchema = z.object({
  campaignId: objectId.optional(),
  partnerId: objectId.optional(),
  subjectType: z.enum(["vendor", "customer"]).optional(),
  state: z.enum(["active", "expired", "revoked"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const listCampaignsQuerySchema = z.object({
  partnerId: objectId.optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
});

export const campaignMetricsQuerySchema = z.object({
  orderDateBasis: z.enum(["createdAt", "paidAt"]).optional(),
});
