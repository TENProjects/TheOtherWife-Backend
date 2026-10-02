/** @format */

import { Router } from "express";

import { AdminReferralController } from "../controllers/admin-referral.controller.js";
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
  updateReferralCodeSchema,
} from "../zod-schema/referral.schema.js";

/**
 * @openapi
 * /api/v1/admin/referrals/partners:
 *   get:
 *     summary: List partners (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
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
 *               name: { type: string, example: FoodCline / Peace Sustainability }
 *               slug: { type: string, example: foodcline }
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
 *     responses:
 *       "201": { description: Credential issued (apiKey shown once) }
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
 * /api/v1/admin/referrals/campaigns:
 *   get:
 *     summary: List referral campaigns (admin)
 *     tags: [Admin – Referrals]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - { in: query, name: partnerId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, active, paused, ended] } }
 *     responses:
 *       "200": { description: Campaigns fetched }
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
 *     description: Changing customerAttributionDays only affects attributions created afterwards.
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
 *               code: { type: string, example: FOODCLINE-CHEF }
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
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *     responses:
 *       "200": { description: Attributions fetched }
 */

class AdminReferralRouter {
  router: Router;
  controller: AdminReferralController;

  constructor() {
    this.router = Router();
    this.controller = new AdminReferralController();
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
