/** @format */

import { Router } from "express";

import { PartnerController } from "../controllers/partner.controller.js";
import {
  partnerAuthMiddleware,
  requirePartnerScope,
} from "../middlewares/partner-auth.middleware.js";
import { partnerIdempotencyMiddleware } from "../middlewares/partner-idempotency.middleware.js";
import { partnerRateLimitMiddleware } from "../middlewares/partner-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { partnerSubmissionSchema } from "../zod-schema/partner.schema.js";

/**
 * @openapi
 * components:
 *   parameters:
 *     IdempotencyKey:
 *       in: header
 *       name: Idempotency-Key
 *       required: true
 *       description: >-
 *         Unique per logical request (e.g. a UUID), 8-128 chars. Retrying with
 *         the same key and body replays the original response (header
 *         Idempotent-Replayed: true). Reusing a key with a different body
 *         returns 422 IDEMPOTENCY_KEY_REUSED. Keys are kept for 72 hours.
 *       schema: { type: string }
 *   schemas:
 *     PartnerSubmissionRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [externalRef, campaignCode, firstName, lastName, email]
 *       properties:
 *         externalRef: { type: string, maxLength: 64, pattern: "^[A-Za-z0-9._-]{1,64}$", description: Partner's own id for this person; unique per partner and type }
 *         campaignCode: { type: string, description: A referral code of a campaign owned by the calling partner }
 *         firstName: { type: string, maxLength: 100 }
 *         lastName: { type: string, maxLength: 100 }
 *         email: { type: string, format: email, description: Must use a domain accepted by TOW signup (gmail.com, yahoo.com, hotmail.com, outlook.com, live.com, icloud.com) }
 *         phoneNumber: { type: string, description: "E.164, e.g. +2348012345678" }
 *         state: { type: string }
 *         city: { type: string }
 *     PartnerSubmission:
 *       type: object
 *       properties:
 *         submissionId: { type: string, example: psub_3f9a1c0b7e2d4a6f8b1c2d3e }
 *         externalRef: { type: string }
 *         type: { type: string, enum: [homechef, customer] }
 *         status:
 *           type: string
 *           enum: [submitted, expired, registered, pending_review, inspected, approved, rejected, suspended, closed]
 *           description: >-
 *             submitted — not yet linked to a TOW account; expired — campaign
 *             ended before the person registered; registered — TOW account
 *             exists (HomeChef: onboarding not yet submitted); pending_review —
 *             HomeChef onboarding submitted, awaiting TOW review; inspected —
 *             TOW inspection completed, awaiting decision; approved / rejected /
 *             suspended — current TOW vendor status; closed — the TOW account
 *             no longer exists.
 *         registeredAt: { type: string, format: date-time, nullable: true }
 *         onboardingSubmittedAt: { type: string, format: date-time, nullable: true, description: HomeChef only }
 *         firstApprovedAt: { type: string, format: date-time, nullable: true, description: HomeChef only }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         claimToken: { type: string, description: Returned only on creation and invite re-issue. Single-use. }
 *         replayed: { type: boolean }
 *
 * /api/v1/partner/me:
 *   get:
 *     summary: Partner credential check — returns the partner, scopes, campaigns and codes
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     responses:
 *       "200": { description: Profile }
 *       "401": { description: PARTNER_UNAUTHORIZED }
 *       "403": { description: "PARTNER_FORBIDDEN_SCOPE (requires partner:read)" }
 *
 * /api/v1/partner/homechefs:
 *   post:
 *     summary: Pre-register a HomeChef lead (requires homechef:submit)
 *     description: >-
 *       Does NOT create a TOW account. Returns a single-use claimToken. The
 *       HomeChef completes the normal TOW vendor onboarding themselves; the
 *       app then claims the token, linking the account to this submission.
 *       Approval remains entirely within TOW's existing inspection and admin
 *       approval process. Idempotent on both the Idempotency-Key header and
 *       (externalRef, payload).
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerSubmissionRequest" }
 *     responses:
 *       "201":
 *         description: Submission created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data: { $ref: "#/components/schemas/PartnerSubmission" }
 *       "200": { description: Same externalRef and identical payload already submitted (replayed=true, no claimToken) }
 *       "400": { description: "Validation error, IDEMPOTENCY_KEY_REQUIRED, REFERRAL_CODE_* or REFERRAL_AUDIENCE_MISMATCH" }
 *       "401": { description: PARTNER_UNAUTHORIZED }
 *       "403": { description: PARTNER_FORBIDDEN_SCOPE }
 *       "409": { description: "DUPLICATE_EXTERNAL_REF (different payload), DUPLICATE_SUBMISSION (email already submitted) or IDEMPOTENCY_IN_PROGRESS" }
 *       "422": { description: IDEMPOTENCY_KEY_REUSED }
 *       "429": { description: Rate limited }
 *   get:
 *     summary: List HomeChef submissions (requires homechef:read)
 *     description: >-
 *       Ordered by updatedAt then id; page with nextCursor. updatedSince
 *       filters on changes to the submission record itself (creation, link,
 *       invite re-issue, first approval) — always read `status` for the
 *       current TOW lifecycle state.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: query, name: updatedSince, schema: { type: string, format: date-time } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200, default: 50 } }
 *     responses:
 *       "200": { description: "Page of submissions: { items, nextCursor }" }
 *
 * /api/v1/partner/homechefs/{externalRef}:
 *   get:
 *     summary: Get one HomeChef submission's current status (requires homechef:read)
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: path, name: externalRef, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Submission }
 *       "404": { description: Not found (or not owned by this partner) }
 *
 * /api/v1/partner/homechefs/{externalRef}/invite:
 *   post:
 *     summary: Re-issue the claim token for an unclaimed HomeChef submission (requires homechef:submit)
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: path, name: externalRef, required: true, schema: { type: string } }
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     responses:
 *       "200": { description: New claimToken; the previous one stops working }
 *       "404": { description: Not found }
 *       "409": { description: Already claimed }
 *
 * /api/v1/partner/customers:
 *   post:
 *     summary: Pre-register a customer lead (requires customer:submit)
 *     description: Same semantics as POST /api/v1/partner/homechefs, for customers.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerSubmissionRequest" }
 *     responses:
 *       "201": { description: Submission created }
 *       "200": { description: Replay }
 *   get:
 *     summary: List customer submissions (requires customer:read)
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: query, name: updatedSince, schema: { type: string, format: date-time } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200, default: 50 } }
 *     responses:
 *       "200": { description: "Page of submissions: { items, nextCursor }" }
 *
 * /api/v1/partner/customers/{externalRef}:
 *   get:
 *     summary: Get one customer submission's current status (requires customer:read)
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: path, name: externalRef, required: true, schema: { type: string } }
 *     responses:
 *       "200": { description: Submission }
 *       "404": { description: Not found }
 *
 * /api/v1/partner/customers/{externalRef}/invite:
 *   post:
 *     summary: Re-issue the claim token for an unclaimed customer submission (requires customer:submit)
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - { in: path, name: externalRef, required: true, schema: { type: string } }
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     responses:
 *       "200": { description: New claimToken }
 */

// Isolated partner surface. Uses ONLY partner credentials — never TOW user
// cookies, roles or admin middleware — and exposes only the operations below.
class PartnerRouter {
  router: Router;
  controller: PartnerController;

  constructor() {
    this.router = Router();
    this.controller = new PartnerController();
    this.router.use(partnerAuthMiddleware, partnerRateLimitMiddleware);
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/me",
      requirePartnerScope("partner:read"),
      this.controller.getProfile,
    );

    for (const [path, type, submitScope, readScope] of [
      ["/homechefs", "homechef", "homechef:submit", "homechef:read"],
      ["/customers", "customer", "customer:submit", "customer:read"],
    ] as const) {
      this.router.post(
        path,
        requirePartnerScope(submitScope),
        partnerIdempotencyMiddleware,
        zodValidation(partnerSubmissionSchema),
        this.controller.submit(type),
      );
      this.router.get(path, requirePartnerScope(readScope), this.controller.list(type));
      this.router.get(
        `${path}/:externalRef`,
        requirePartnerScope(readScope),
        this.controller.getOne(type),
      );
      this.router.post(
        `${path}/:externalRef/invite`,
        requirePartnerScope(submitScope),
        partnerIdempotencyMiddleware,
        this.controller.reissueInvite(type),
      );
    }
  }
}

export const partnerRouter = new PartnerRouter().router;
