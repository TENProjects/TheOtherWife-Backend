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

// Commercial rules (see models/referralCampaign.model.ts).
const homechefRules = z.strictObject({
  earlyTierSize: z.number().int().min(0).max(100000),
  requireInspection: z.boolean(),
  requireMenu: z.boolean(),
  completedOrdersAfterEarlyTier: z.number().int().min(0).max(1000),
  payoutPerHomechef: z.number().min(0).max(100_000_000),
  settlementBatchSize: z.number().int().min(1).max(10000),
  payableCap: z.number().int().min(0).max(1_000_000),
  windowDays: z.number().int().min(1).max(3650),
});
const customerRules = z.strictObject({
  revenueSharePercent: z.number().min(0).max(100),
  deductPlatformCost: z.boolean(),
});
const activeRules = z
  .strictObject({
    minCompletedOrdersPerWeek: z.number().int().min(1).max(1000),
    internalTargetPerWeek: z.number().int().min(1).max(1000),
  })
  .refine((r) => r.internalTargetPerWeek >= r.minCompletedOrdersPerWeek, {
    message: "internalTargetPerWeek must be at least minCompletedOrdersPerWeek",
  });
const campaignRules = z.strictObject({
  homechef: homechefRules.optional(),
  customer: customerRules.optional(),
  active: activeRules.optional(),
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
  rules: campaignRules.optional(),
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
  rules: campaignRules.optional(),
  // Admin override of the automatically opened HomeChef window.
  windowStartsAt: isoDate.nullable().optional(),
  windowEndsAt: isoDate.nullable().optional(),
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

const ipAllowlist = z.array(z.union([z.ipv4(), z.ipv6()])).max(20);

export const issuePartnerCredentialSchema = z.strictObject({
  scopes: z.array(z.enum(PARTNER_SCOPES)).min(1),
  label: z.string().trim().max(200).optional(),
  expiresAt: isoDate.optional(),
  ipAllowlist: ipAllowlist.optional(),
  requireSignature: z.boolean().optional(),
});

export const updatePartnerCredentialSchema = z
  .strictObject({
    requireSignature: z.boolean().optional(),
    ipAllowlist: ipAllowlist.optional(),
  })
  .refine((data) => data.requireSignature !== undefined || data.ipAllowlist !== undefined, {
    message: "Provide requireSignature and/or ipAllowlist",
  });

// ── Admin: partner webhooks ─────────────────────────────────────────────

export const configurePartnerWebhookSchema = z.strictObject({
  url: z
    .url()
    .trim()
    .max(2048)
    .refine((value) => value.startsWith("https://"), { message: "Webhook URL must use https" }),
  enabled: z.boolean(),
});

export const listWebhookDeliveriesQuerySchema = z.object({
  status: z.enum(["pending", "delivered", "failed", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Admin: query strings ────────────────────────────────────────────────

// Shared pagination for every admin list: page >= 1, 1 <= limit <= 100.
// A limit above 100 is rejected (400), not silently clamped.
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const booleanQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const listAttributionsQuerySchema = paginationQuerySchema.extend({
  campaignId: objectId.optional(),
  partnerId: objectId.optional(),
  subjectType: z.enum(["vendor", "customer"]).optional(),
  state: z.enum(["active", "expired", "revoked"]).optional(),
  qualified: booleanQuery.optional(),
});

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  partnerId: objectId.optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
});

export const listPartnersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["active", "suspended"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const listCodesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["active", "disabled"]).optional(),
});

export const listCredentialsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["active", "revoked"]).optional(),
});

export const listSettlementsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(["customer_weekly", "homechef_batch"]).optional(),
  status: z.enum(["finalized", "paid"]).optional(),
});

// ── Admin: settlements ──────────────────────────────────────────────────

export const upsertPlatformCostSchema = z.strictObject({
  amount: z.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(500).optional(),
});

export const markSettlementPaidSchema = z.strictObject({
  paymentReference: z.string().trim().min(1).max(200),
  paidAt: isoDate.optional(),
});

export const campaignMetricsQuerySchema = z.object({
  orderDateBasis: z.enum(["createdAt", "paidAt"]).optional(),
});

// ── Admin: partnership screens (Overview / HomeChefs / Customers / Earnings)

// The screens' "Time" filter: an optional [from, to) range (ISO dates).
const dateRangeQuery = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
const searchQuery = z.string().trim().min(1).max(100).optional();
const rangeIsValid = (q: { from?: Date; to?: Date }) => !q.from || !q.to || q.to.getTime() > q.from.getTime();
const rangeMessage = { message: "`to` must be after `from`", path: ["to"] };

export const listPartnershipsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
});

export const partnershipHomechefsQuerySchema = paginationQuerySchema
  .extend({
    ...dateRangeQuery,
    status: z.enum(["all", "pending", "approved", "rejected", "suspended", "successful"]).default("all"),
    search: searchQuery,
  })
  .refine(rangeIsValid, rangeMessage);

export const partnershipCustomersQuerySchema = paginationQuerySchema
  .extend({
    ...dateRangeQuery,
    purchase: z.enum(["all", "purchased", "none"]).default("all"),
    search: searchQuery,
  })
  .refine(rangeIsValid, rangeMessage);

export const partnershipEarningsActivityQuerySchema = paginationQuerySchema
  .extend({
    ...dateRangeQuery,
    source: z.enum(["all", "homechef", "customer", "payout"]).default("all"),
    search: searchQuery,
  })
  .refine(rangeIsValid, rangeMessage);
