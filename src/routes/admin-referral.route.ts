/** @format */

import { Router } from "express";

import { AdminReferralController } from "../controllers/admin-referral.controller.js";
import { AdminPartnershipController } from "../controllers/admin-partnership.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  createCampaignSchema,
  createPartnerSchema,
  createReferralCodeSchema,
  issuePartnerCredentialSchema,
  updateCampaignSchema,
  updatePartnerSchema,
  updatePartnerCredentialSchema,
  configurePartnerWebhookSchema,
  upsertPlatformCostSchema,
  markSettlementPaidSchema,
  updateReferralCodeSchema,
} from "../zod-schema/referral.schema.js";

/**
 * @openapi
 * components:
 *   parameters:
 *     AdminPage:
 *       in: query
 *       name: page
 *       required: false
 *       schema: { type: integer, minimum: 1, default: 1 }
 *     AdminLimit:
 *       in: query
 *       name: limit
 *       required: false
 *       description: Items per page (1-100). Values above 100 are rejected with 400.
 *       schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *   schemas:
 *     AdminPagination:
 *       type: object
 *       properties:
 *         page: { type: integer }
 *         limit: { type: integer }
 *         total: { type: integer }
 *         totalPages: { type: integer }
 *     CampaignRules:
 *       type: object
 *       description: Commercial rules. Optional; a campaign without them has no qualification or settlement.
 *       properties:
 *         homechef:
 *           type: object
 *           properties:
 *             earlyTierSize: { type: integer, example: 100, description: The first N HomeChefs meeting the base rule qualify on it alone }
 *             requireInspection: { type: boolean, example: true }
 *             requireMenu: { type: boolean, example: true, description: At least one published, available meal }
 *             completedOrdersAfterEarlyTier: { type: integer, example: 1, description: Delivered + paid orders needed after the early tier }
 *             payoutPerHomechef: { type: number, example: 3000 }
 *             settlementBatchSize: { type: integer, example: 50 }
 *             payableCap: { type: integer, example: 1000 }
 *             windowDays: { type: integer, example: 90, description: Window opens automatically at the first approval }
 *         customer:
 *           type: object
 *           properties:
 *             revenueSharePercent: { type: number, example: 50, description: "Partner share of TOW earned (20% platform fee + service charge - Paystack fee)" }
 *             deductPlatformCost: { type: boolean, example: true, description: Deduct the platform running cost attributable to the partner's orders }
 *             costSharing:
 *               type: string
 *               enum: [partner_absorbs, proportional]
 *               default: partner_absorbs
 *               description: "partner_absorbs: the partner bears all of that cost (payout = share - cost). proportional: the cost is shared in the same ratio as earnings, a true profit split (payout = share% x (TOW earned - cost)). Locked, like all rules, once a settlement is finalized."
 *         active:
 *           type: object
 *           properties:
 *             minCompletedOrdersPerWeek: { type: integer, example: 1 }
 *             internalTargetPerWeek: { type: integer, example: 2 }
 *
 * /api/v1/admin/referrals/platform-costs:
 *   get:
 *     summary: List monthly platform infrastructure costs, newest first (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items, pagination }" }
 *
 * /api/v1/admin/referrals/platform-costs/{month}:
 *   put:
 *     summary: Set the platform infrastructure cost for a month (super_admin, manager)
 *     description: >-
 *       Used to allocate cost to partner weekly statements (per-day cost x the
 *       partner's share of TOW earned). 0 is allowed. A month already used by
 *       a finalized statement is locked (409).
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: month, required: true, schema: { type: string, example: "2026-10" } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, example: 64000 }
 *               note: { type: string }
 *     responses:
 *       "200": { description: Saved }
 *       "409": { description: Month already used by a finalized statement }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/customer-statements:
 *   get:
 *     summary: List the campaign's weekly customer statements (admin)
 *     description: >-
 *       Mon-Sun weeks in West Africa Time, newest first. state is in_progress
 *       (current week), ready (ended, not finalized), finalized or paid.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items: [{ weekStart, state, settlementId, payout, ... }], pagination }" }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/customer-statements/{weekStart}:
 *   get:
 *     summary: Preview one week's customer statement, or its recorded snapshot once finalized (admin)
 *     description: >-
 *       Totals (TOW earned, partner share, allocated platform cost,
 *       adjustments, payout) are always complete; order lines are paginated.
 *       canFinalize and blockers explain whether it can be finalized now.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: weekStart, required: true, description: "Monday, YYYY-MM-DD (WAT)", schema: { type: string, example: "2026-10-05" } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Statement }
 *       "400": { description: weekStart is not a Monday / campaign has no customer rules }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/customer-statements/{weekStart}/finalize:
 *   post:
 *     summary: Finalize (record) one week's customer statement (super_admin, manager)
 *     description: >-
 *       Only after the week has ended, in order (the week after the latest
 *       finalized one), and only when every month the week touches has a
 *       platform cost. Snapshots every line. Cannot be repeated.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: weekStart, required: true, schema: { type: string } }
 *     responses:
 *       "201": { description: Finalized }
 *       "409": { description: Not finalizable yet (reasons in the message) or already finalized }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/homechef-batches:
 *   get:
 *     summary: List HomeChef payout batches (admin)
 *     description: >-
 *       Batch n covers successful-HomeChef ranks 50(n-1)+1 to 50n up to the
 *       payable cap. state is pending, ready (full), finalized or paid.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Batches }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/homechef-batches/{batchNumber}:
 *   get:
 *     summary: One HomeChef batch with its HomeChefs (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: batchNumber, required: true, schema: { type: integer } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "Batch and { items, pagination }" }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/homechef-batches/{batchNumber}/finalize:
 *   post:
 *     summary: Finalize (record) a full HomeChef batch (super_admin, manager)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: batchNumber, required: true, schema: { type: integer } }
 *     responses:
 *       "201": { description: Finalized }
 *       "409": { description: Batch not full or already finalized }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/settlements:
 *   get:
 *     summary: List recorded settlements of a campaign (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: query, name: type, schema: { type: string, enum: [customer_weekly, homechef_batch] } }
 *       - { in: query, name: status, schema: { type: string, enum: [finalized, paid] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items, pagination }" }
 *
 * /api/v1/admin/referrals/settlements/{settlementId}:
 *   get:
 *     summary: One recorded settlement with its lines (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: settlementId, required: true, schema: { type: string, example: pstl_3f9a1c0b7e2d4a6f8b1c2d3e } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "Settlement and { items, pagination }" }
 *       "404": { description: Not found }
 *
 * /api/v1/admin/referrals/settlements/{settlementId}/mark-paid:
 *   patch:
 *     summary: Record that a finalized settlement has been paid (super_admin, manager)
 *     description: Moves finalized to paid, once only. No money is moved by the system.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: settlementId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentReference]
 *             properties:
 *               paymentReference: { type: string, example: "TRF-2026-10-14-0091" }
 *               paidAt: { type: string, format: date-time }
 *     responses:
 *       "200": { description: Marked paid }
 *       "409": { description: Already paid }
 *
 * /api/v1/admin/referrals/partnerships:
 *   get:
 *     summary: Partnerships list cards (admin)
 *     description: >-
 *       One item per partner campaign: header (partner, status, period, days
 *       remaining, HomeChef window), totalReferrals and totalEarnings (gross
 *       partner earnings), each with a change % vs last WAT week (null when
 *       last week was 0 and this week isn't).
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, active, paused, ended] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items, pagination }" }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/overview:
 *   get:
 *     summary: Partnership Overview tab (admin)
 *     description: >-
 *       header; cards { successfulHomechefs { count, target, percentOfTarget },
 *       referredCustomers, customerPurchaseValue, partnerEarnings };
 *       referralActivity (per WAT week since campaign start: homechefReferrals,
 *       customerReferrals); recentActivity (paginated feed: referred, approved,
 *       successful, customer purchase, payout finalized/paid).
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Overview }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/homechefs:
 *   get:
 *     summary: Partnership HomeChefs tab (admin)
 *     description: >-
 *       cards { totalReferred, registered, approved, pending, rejected,
 *       suspended } (campaign-wide); progress { successful, target, percent };
 *       tabs (counts for the current search/time filter); items with status
 *       (pending | approved | rejected | suspended | closed), approvalDate,
 *       successful, rank and incentive { eligibleAmount, payoutStatus:
 *       not_eligible | earned | pending | paid | over_cap, batchNumber }.
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [all, pending, approved, rejected, suspended, successful], default: all } }
 *       - { in: query, name: search, description: Name, email, business name or partner ID, schema: { type: string } }
 *       - { in: query, name: from, description: "Time filter start (ISO date, inclusive)", schema: { type: string, format: date-time } }
 *       - { in: query, name: to, description: "Time filter end (ISO date, exclusive)", schema: { type: string, format: date-time } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "HomeChefs { header, cards, progress, tabs, items, pagination }" }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/homechefs/{attributionId}:
 *   get:
 *     summary: HomeChef details modal (admin)
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: attributionId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: "{ name, referral, onboarding, success, incentive, ruleText }" }
 *       "404": { description: Not found }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/customers:
 *   get:
 *     summary: Partnership Customers tab (admin)
 *     description: >-
 *       cards { totalReferred, withPurchases, purchaseValue, commission }
 *       (campaign-wide); commissionRule text; tabs { all, purchased,
 *       noPurchase }; items with purchases, purchaseValue (order totals),
 *       towEarned and commission (share % of TOW earned, not of purchase value).
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: query, name: purchase, schema: { type: string, enum: [all, purchased, none], default: all } }
 *       - { in: query, name: search, description: Name, email or partner ID, schema: { type: string } }
 *       - { in: query, name: from, description: "Time filter start (ISO date, inclusive)", schema: { type: string, format: date-time } }
 *       - { in: query, name: to, description: "Time filter end (ISO date, exclusive)", schema: { type: string, format: date-time } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "Customers { header, cards, commissionRule, tabs, items, pagination }" }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/customers/{attributionId}:
 *   get:
 *     summary: Customer details modal with paginated purchase history (admin)
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: attributionId, required: true, schema: { type: string } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ name, referral, totals, commissionPeriodEndsAt, note, purchaseHistory { items, pagination } }" }
 *       "404": { description: Not found }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/earnings:
 *   get:
 *     summary: Partnership Earnings tab summary (admin)
 *     description: >-
 *       cards { homechefIncentives, customerCommission, totalEarned (gross),
 *       platformCostDeducted, paidOut, pendingPayout, notYetSettled } and the
 *       breakdown table (HomeChef, Customer, Platform cost, Net).
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Earnings }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/earnings/activity:
 *   get:
 *     summary: Partnership Earnings activity list (admin)
 *     description: >-
 *       HomeChef rows (one per batch), Customer rows (one per WAT week with
 *       qualifying purchases) and Payout rows (one per recorded settlement,
 *       numbered #001…). status is earned (not yet finalized), pending
 *       (finalized, awaiting payment) or paid. tabs gives the counts. "all"
 *       shows HomeChef + Customer rows; "payout" shows payouts.
 *     tags: [Admin – Partnerships]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: query, name: source, schema: { type: string, enum: [all, homechef, customer, payout], default: all } }
 *       - { in: query, name: search, description: Matches description or payment reference, schema: { type: string } }
 *       - { in: query, name: from, description: "Time filter start (ISO date, inclusive)", schema: { type: string, format: date-time } }
 *       - { in: query, name: to, description: "Time filter end (ISO date, exclusive)", schema: { type: string, format: date-time } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ tabs, items, pagination }" }
 *
 * /api/v1/admin/referrals/partners:
 *   get:
 *     summary: List partners (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, suspended] } }
 *       - { in: query, name: search, description: Matches name or slug, schema: { type: string } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Partners fetched }
 *       "401": { description: Unauthorized }
 *       "403": { description: Forbidden }
 *   post:
 *     summary: Create a partner (super_admin, manager)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name: { type: string, example: FoodClime / Peace Sustainability }
 *               slug: { type: string, example: foodclime }
 *               contactEmail: { type: string, format: email }
 *               notes: { type: string }
 *     responses:
 *       "201": { description: Partner created }
 *       "409": { description: Slug already exists (RESOURCE_CONFLICT) }
 *
 * /api/v1/admin/referrals/partners/{partnerId}:
 *   get:
 *     summary: Get a partner (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Partner fetched }
 *       "404": { description: Not found }
 *   patch:
 *     summary: Update a partner, e.g. suspend it (super_admin, manager)
 *     description: Suspending a partner immediately disables its API credentials and its campaign codes.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               status: { type: string, enum: [active, suspended] }
 *               contactEmail: { type: string, format: email }
 *               notes: { type: string }
 *     responses:
 *       "200": { description: Partner updated }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/credentials:
 *   get:
 *     summary: List a partner's API credentials (super_admin) — secrets are never returned
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, revoked] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Credentials fetched }
 *   post:
 *     summary: Issue a partner API key (super_admin)
 *     description: >-
 *       Returns `apiKey` exactly once (format `tow_pk_<keyId>.<secret>`).
 *       Only a SHA-256 hash of the secret is stored. Scopes are explicit —
 *       there is no wildcard.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scopes]
 *             properties:
 *               scopes:
 *                 type: array
 *                 items: { type: string, enum: [partner:read, homechef:submit, homechef:read, customer:submit, customer:read] }
 *               label: { type: string }
 *               expiresAt: { type: string, format: date-time }
 *               ipAllowlist: { type: array, items: { type: string } }
 *               requireSignature: { type: boolean, default: false }
 *     responses:
 *       "201": { description: "Credential issued. apiKey and signingSecret (request-signing secret; null if PARTNER_SECRETS_KEY is not configured) are shown once." }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/credentials/{keyId}/revoke:
 *   patch:
 *     summary: Revoke a partner API key immediately (super_admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: path, name: keyId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Credential revoked }
 *       "404": { description: Not found }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/credentials/{keyId}:
 *   patch:
 *     summary: Change signature enforcement and/or the IP allow-list of a partner API key (super_admin)
 *     description: >-
 *       requireSignature=true makes every request with this key need a valid
 *       HMAC signature (requires a signing secret). An empty ipAllowlist removes
 *       the IP restriction. IPv4-mapped IPv6 and IPv6 spellings are normalised.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: path, name: keyId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requireSignature: { type: boolean }
 *               ipAllowlist: { type: array, items: { type: string }, example: ["57.131.129.32", "2001:41d0:701:1100::e31a"] }
 *     responses:
 *       "200": { description: Credential updated }
 *       "400": { description: Invalid IP, or no signing secret exists yet }
 *       "404": { description: Not found }
 *       "409": { description: Credential is revoked }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/credentials/{keyId}/signing-secret:
 *   post:
 *     summary: Generate or rotate the request-signing secret of a partner API key (super_admin)
 *     description: Returns signingSecret once. The previous signing secret stops working immediately.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: path, name: keyId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Signing secret issued (shown once) }
 *       "404": { description: Not found or revoked }
 *       "500": { description: PARTNER_SECRETS_KEY is not configured }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/webhook:
 *   get:
 *     summary: Get the webhook settings of a partner (super_admin); the secret is never returned
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Webhook settings }
 *   put:
 *     summary: Create or update the status webhook of a partner (super_admin)
 *     description: >-
 *       The URL must be https and must not resolve to a private or reserved
 *       address. On first configuration a signingSecret (whsec_...) is
 *       returned once. Events are submission.status_changed, signed with
 *       HMAC-SHA256 over "<timestamp>.<raw body>".
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, enabled]
 *             properties:
 *               url: { type: string, format: uri, example: "https://api.foodclime.example/webhooks/tow" }
 *               enabled: { type: boolean }
 *     responses:
 *       "200": { description: Webhook saved (signingSecret included only when newly generated) }
 *       "400": { description: Invalid or unsafe URL }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/webhook/rotate-secret:
 *   post:
 *     summary: Rotate the webhook signing secret of a partner (super_admin)
 *     description: Returns the new signingSecret once. Events sent afterwards are signed with it.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: New secret (shown once) }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/webhook/test:
 *   post:
 *     summary: Send a signed ping event to the partner webhook now (super_admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: "Outcome: { eventId, delivered, responseStatus, error }" }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/webhook/deliveries:
 *   get:
 *     summary: List webhook deliveries for a partner (super_admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, delivered, failed, cancelled] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items, pagination }" }
 *
 * /api/v1/admin/referrals/partners/{partnerId}/webhook/deliveries/{eventId}/retry:
 *   post:
 *     summary: Re-queue a failed or cancelled webhook delivery (super_admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: partnerId, required: true, schema: { type: string } }
 *       - { in: path, name: eventId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Re-queued }
 *       "404": { description: Not found }
 *       "409": { description: Delivery is not failed or cancelled }
 *
 * /api/v1/admin/referrals/campaigns:
 *   get:
 *     summary: List referral campaigns (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: partnerId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, active, paused, ended] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: "{ items, pagination }" }
 *   post:
 *     summary: Create a referral campaign (super_admin, manager)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, programType, startsAt, audiences]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               programType: { type: string, enum: [internal_user, partner, campaign] }
 *               partnerId: { type: string, description: Required when programType is partner }
 *               status: { type: string, enum: [draft, active, paused, ended], default: draft }
 *               startsAt: { type: string, format: date-time }
 *               endsAt: { type: string, format: date-time }
 *               audiences: { type: array, items: { type: string, enum: [vendor, customer] } }
 *               customerAttributionDays: { type: integer, default: 90 }
 *               claimWindowDays: { type: integer, default: 7, description: Max account age (days) at claim time }
 *               targets:
 *                 type: object
 *                 properties:
 *                   homechefs: { type: integer }
 *                   customers: { type: integer }
 *               rules: { $ref: "#/components/schemas/CampaignRules" }
 *     responses:
 *       "201": { description: Campaign created }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}:
 *   get:
 *     summary: Get a referral campaign (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Campaign fetched }
 *   patch:
 *     summary: Update a referral campaign (super_admin, manager)
 *     description: >-
 *       Changing customerAttributionDays only affects attributions created
 *       afterwards. Accepts rules (locked once any settlement is finalized,
 *       409) and windowStartsAt / windowEndsAt to override the automatically
 *       opened HomeChef window (null clears it).
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Campaign updated }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/codes:
 *   get:
 *     summary: List a campaign's referral codes (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, disabled] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Codes fetched }
 *   post:
 *     summary: Generate a referral code for a campaign (super_admin, manager)
 *     description: >-
 *       Omit `code` to generate a random 8-character code (no ambiguous
 *       characters), or pass a vanity code (4-32 chars, A-Z 0-9 and single
 *       hyphens). Codes are attribution identifiers, not credentials.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audience]
 *             properties:
 *               code: { type: string, example: FOODCLIME-CHEF }
 *               audience: { type: string, enum: [vendor, customer, both] }
 *               expiresAt: { type: string, format: date-time }
 *               maxUses: { type: integer }
 *               ownerUserId: { type: string, description: internal_user campaigns only }
 *               label: { type: string }
 *     responses:
 *       "201": { description: Code created }
 *       "409": { description: Code already exists }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/codes/{codeId}:
 *   patch:
 *     summary: Update / disable a referral code (super_admin, manager)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - { in: path, name: codeId, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Code updated }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/metrics:
 *   get:
 *     summary: Campaign attribution metrics (admin)
 *     description: >-
 *       Computed on request from Vendor and Order records joined through
 *       Attribution. The response includes a `definitions` object describing
 *       every number. "qualifying", "active" and "targetProgress" are null
 *       until the business defines them. No commission or settlement amounts
 *       are calculated.
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *       - in: query
 *         name: orderDateBasis
 *         schema: { type: string, enum: [createdAt, paidAt], default: createdAt }
 *     responses:
 *       "200": { description: Metrics computed }
 *
 * /api/v1/admin/referrals/campaigns/{campaignId}/export:
 *   get:
 *     summary: Export a campaign's attributions as CSV (super_admin, manager)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       "200":
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema: { type: string }
 *
 * /api/v1/admin/referrals/attributions:
 *   get:
 *     summary: List attributions (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: campaignId, schema: { type: string } }
 *       - { in: query, name: partnerId, schema: { type: string } }
 *       - { in: query, name: subjectType, schema: { type: string, enum: [vendor, customer] } }
 *       - { in: query, name: state, schema: { type: string, enum: [active, expired, revoked] } }
 *       - { in: query, name: qualified, description: Successful HomeChefs only (true) or not yet (false), schema: { type: string, enum: ["true", "false"] } }
 *       - $ref: "#/components/parameters/AdminPage"
 *       - $ref: "#/components/parameters/AdminLimit"
 *     responses:
 *       "200": { description: Attributions fetched }
 */

class AdminReferralRouter {
  router: Router;
  controller: AdminReferralController;
  partnerships: AdminPartnershipController;

  constructor() {
    this.router = Router();
    this.controller = new AdminReferralController();
    this.partnerships = new AdminPartnershipController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    const anyAdmin = requireAdminRole(["super_admin", "manager", "support_agent"]);
    const managers = requireAdminRole(["super_admin", "manager"]);
    const superAdmin = requireAdminRole(["super_admin"]);

    // Partners
    this.router.get("/partners", anyAdmin, this.controller.listPartners);
    this.router.post(
      "/partners",
      managers,
      zodValidation(createPartnerSchema),
      this.controller.createPartner,
    );
    this.router.get("/partners/:partnerId", anyAdmin, this.controller.getPartner);
    this.router.patch(
      "/partners/:partnerId",
      managers,
      zodValidation(updatePartnerSchema),
      this.controller.updatePartner,
    );

    // Partner API credentials — super_admin only.
    this.router.get(
      "/partners/:partnerId/credentials",
      superAdmin,
      this.controller.listCredentials,
    );
    this.router.post(
      "/partners/:partnerId/credentials",
      superAdmin,
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(issuePartnerCredentialSchema),
      this.controller.issueCredential,
    );
    this.router.patch(
      "/partners/:partnerId/credentials/:keyId/revoke",
      superAdmin,
      this.controller.revokeCredential,
    );

    this.router.patch(
      "/partners/:partnerId/credentials/:keyId",
      superAdmin,
      zodValidation(updatePartnerCredentialSchema),
      this.controller.updateCredential,
    );
    this.router.post(
      "/partners/:partnerId/credentials/:keyId/signing-secret",
      superAdmin,
      adminSensitiveActionRateLimitMiddleware,
      this.controller.rotateSigningSecret,
    );

    // Partner webhooks — super_admin only.
    this.router.get("/partners/:partnerId/webhook", superAdmin, this.controller.getWebhook);
    this.router.put(
      "/partners/:partnerId/webhook",
      superAdmin,
      zodValidation(configurePartnerWebhookSchema),
      this.controller.configureWebhook,
    );
    this.router.post(
      "/partners/:partnerId/webhook/rotate-secret",
      superAdmin,
      adminSensitiveActionRateLimitMiddleware,
      this.controller.rotateWebhookSecret,
    );
    this.router.post(
      "/partners/:partnerId/webhook/test",
      superAdmin,
      this.controller.testWebhook,
    );
    this.router.get(
      "/partners/:partnerId/webhook/deliveries",
      superAdmin,
      this.controller.listWebhookDeliveries,
    );
    this.router.post(
      "/partners/:partnerId/webhook/deliveries/:eventId/retry",
      superAdmin,
      this.controller.retryWebhookDelivery,
    );

    // Campaigns
    this.router.get("/campaigns", anyAdmin, this.controller.listCampaigns);
    this.router.post(
      "/campaigns",
      managers,
      zodValidation(createCampaignSchema),
      this.controller.createCampaign,
    );
    this.router.get("/campaigns/:campaignId", anyAdmin, this.controller.getCampaign);
    this.router.patch(
      "/campaigns/:campaignId",
      managers,
      zodValidation(updateCampaignSchema),
      this.controller.updateCampaign,
    );

    // Partnership screens (read-only, any admin).
    this.router.get("/partnerships", anyAdmin, this.partnerships.listPartnerships);
    this.router.get("/campaigns/:campaignId/overview", anyAdmin, this.partnerships.getOverview);
    this.router.get("/campaigns/:campaignId/homechefs", anyAdmin, this.partnerships.listHomechefs);
    this.router.get(
      "/campaigns/:campaignId/homechefs/:attributionId",
      anyAdmin,
      this.partnerships.getHomechef,
    );
    this.router.get("/campaigns/:campaignId/customers", anyAdmin, this.partnerships.listCustomers);
    this.router.get(
      "/campaigns/:campaignId/customers/:attributionId",
      anyAdmin,
      this.partnerships.getCustomer,
    );
    this.router.get("/campaigns/:campaignId/earnings", anyAdmin, this.partnerships.getEarnings);
    this.router.get(
      "/campaigns/:campaignId/earnings/activity",
      anyAdmin,
      this.partnerships.listEarningsActivity,
    );

    // Settlements & platform costs. Viewing: any admin. Recording money
    // (finalize, mark paid, platform cost): super_admin or manager.
    this.router.get("/platform-costs", anyAdmin, this.controller.listPlatformCosts);
    this.router.put(
      "/platform-costs/:month",
      managers,
      zodValidation(upsertPlatformCostSchema),
      this.controller.upsertPlatformCost,
    );
    this.router.get(
      "/campaigns/:campaignId/customer-statements",
      anyAdmin,
      this.controller.listCustomerWeeks,
    );
    this.router.get(
      "/campaigns/:campaignId/customer-statements/:weekStart",
      anyAdmin,
      this.controller.getCustomerWeek,
    );
    this.router.post(
      "/campaigns/:campaignId/customer-statements/:weekStart/finalize",
      managers,
      adminSensitiveActionRateLimitMiddleware,
      this.controller.finalizeCustomerWeek,
    );
    this.router.get(
      "/campaigns/:campaignId/homechef-batches",
      anyAdmin,
      this.controller.listHomechefBatches,
    );
    this.router.get(
      "/campaigns/:campaignId/homechef-batches/:batchNumber",
      anyAdmin,
      this.controller.getHomechefBatch,
    );
    this.router.post(
      "/campaigns/:campaignId/homechef-batches/:batchNumber/finalize",
      managers,
      adminSensitiveActionRateLimitMiddleware,
      this.controller.finalizeHomechefBatch,
    );
    this.router.get(
      "/campaigns/:campaignId/settlements",
      anyAdmin,
      this.controller.listSettlements,
    );
    this.router.get("/settlements/:settlementId", anyAdmin, this.controller.getSettlement);
    this.router.patch(
      "/settlements/:settlementId/mark-paid",
      managers,
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(markSettlementPaidSchema),
      this.controller.markSettlementPaid,
    );

    // Codes
    this.router.get(
      "/campaigns/:campaignId/codes",
      anyAdmin,
      this.controller.listCodes,
    );
    this.router.post(
      "/campaigns/:campaignId/codes",
      managers,
      zodValidation(createReferralCodeSchema),
      this.controller.createCode,
    );
    this.router.patch(
      "/campaigns/:campaignId/codes/:codeId",
      managers,
      zodValidation(updateReferralCodeSchema),
      this.controller.updateCode,
    );

    // Reporting
    this.router.get(
      "/campaigns/:campaignId/metrics",
      anyAdmin,
      this.controller.getCampaignMetrics,
    );
    this.router.get(
      "/campaigns/:campaignId/export",
      managers,
      this.controller.exportCampaignCsv,
    );
    this.router.get("/attributions", anyAdmin, this.controller.listAttributions);
  }
}

export const adminReferralRouter = new AdminReferralRouter().router;
