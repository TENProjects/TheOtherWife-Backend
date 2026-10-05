/** @format */

import { Router } from "express";

import { PartnerController } from "../controllers/partner.controller.js";
import {
  partnerAuthMiddleware,
  requirePartnerScope,
} from "../middlewares/partner-auth.middleware.js";
import { partnerSignatureMiddleware } from "../middlewares/partner-signature.middleware.js";
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
 *         Unique per logical request (e.g. a UUID), 8-128 chars
 *         (A-Z a-z 0-9 _ - : .). Retrying with the same key and body replays
 *         the original response with header `Idempotent-Replayed: true`.
 *         Reusing a key with a different body returns 422
 *         IDEMPOTENCY_KEY_REUSED. Keys are kept for 72 hours. 5xx responses
 *         are not stored, so they can be retried with the same key.
 *       schema: { type: string, example: 7c9e6679-7425-40de-944b-e07fc1f90ae7 }
 *     PartnerExternalRef:
 *       in: path
 *       name: externalRef
 *       required: true
 *       description: Your own id for the person, as sent when the submission was created.
 *       schema: { type: string, pattern: "^[A-Za-z0-9._-]{1,64}$", example: fc-chef-00123 }
 *     PartnerUpdatedSince:
 *       in: query
 *       name: updatedSince
 *       required: false
 *       description: >-
 *         ISO 8601 date-time. Returns submissions created or changed at or
 *         after this time, including every status change. TOW detects status
 *         changes within about 5 minutes, so overlap your polling window by a
 *         few minutes.
 *       schema: { type: string, format: date-time }
 *     PartnerCursor:
 *       in: query
 *       name: cursor
 *       required: false
 *       description: Value of `nextCursor` from the previous page.
 *       schema: { type: string }
 *     PartnerLimit:
 *       in: query
 *       name: limit
 *       required: false
 *       schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *
 *   headers:
 *     IdempotentReplayed:
 *       description: Present (value "true") when this response is a replay of an earlier request with the same Idempotency-Key.
 *       schema: { type: string, example: "true" }
 *     RateLimit:
 *       description: Requests remaining in the current window (IETF RateLimit header fields — RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset are all sent).
 *       schema: { type: string }
 *
 *   schemas:
 *     PartnerError:
 *       type: object
 *       required: [status, message]
 *       properties:
 *         status: { type: string, enum: [error], example: error }
 *         message: { type: string, example: Invalid campaign code }
 *         error:
 *           description: >-
 *             A stable error code (string). For request validation failures
 *             (message "Validation error") this is instead an array of
 *             field issues.
 *           oneOf:
 *             - type: string
 *               enum: [PARTNER_UNAUTHORIZED, PARTNER_SIGNATURE_INVALID, PARTNER_FORBIDDEN_SCOPE, VALIDATION_ERROR, IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS, DUPLICATE_EXTERNAL_REF, DUPLICATE_SUBMISSION, REFERRAL_CODE_INVALID, REFERRAL_CODE_DISABLED, REFERRAL_CODE_EXPIRED, REFERRAL_AUDIENCE_MISMATCH, RESOURCE_NOT_FOUND, RESOURCE_CONFLICT]
 *             - type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   path: { type: array, items: { oneOf: [{ type: string }, { type: integer }] }, example: [email] }
 *                   message: { type: string, example: Invalid email address }
 *                   code: { type: string, example: invalid_format }
 *
 *     PartnerSubmissionRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [externalRef, campaignCode, firstName, lastName, email]
 *       properties:
 *         externalRef: { type: string, pattern: "^[A-Za-z0-9._-]{1,64}$", description: "Your own id for this person. Unique per partner and type (HomeChef / customer).", example: fc-chef-00123 }
 *         campaignCode: { type: string, minLength: 4, maxLength: 32, description: "One of your campaign codes (HomeChef code for /homechefs, customer code for /customers).", example: FOODCLIME-CHEF }
 *         firstName: { type: string, minLength: 1, maxLength: 100, example: Ada }
 *         lastName: { type: string, minLength: 1, maxLength: 100, example: Obi }
 *         email: { type: string, format: email, maxLength: 255, description: "Must use a domain accepted by TOW signup: gmail.com, yahoo.com, hotmail.com, outlook.com, live.com, icloud.com, or a Nigerian university domain ending in .edu.ng (e.g. uniabuja.edu.ng). Each email can be submitted once per type.", example: ada.obi@gmail.com }
 *         phoneNumber: { type: string, pattern: "^\\+[1-9]\\d{7,14}$", description: "E.164 international format", example: "+2348012345678" }
 *         state: { type: string, minLength: 1, maxLength: 100, example: Lagos }
 *         city: { type: string, minLength: 1, maxLength: 100, example: Ikeja }
 *
 *     PartnerSubmission:
 *       type: object
 *       required: [submissionId, externalRef, type, status, registeredAt, createdAt, updatedAt]
 *       properties:
 *         submissionId: { type: string, description: Opaque TOW reference for this submission, example: psub_3f9a1c0b7e2d4a6f8b1c2d3e }
 *         externalRef: { type: string, example: fc-chef-00123 }
 *         type: { type: string, enum: [homechef, customer] }
 *         status:
 *           type: string
 *           enum: [submitted, expired, registered, pending_review, inspected, approved, rejected, suspended, closed]
 *           description: >-
 *             submitted — not yet linked to a TOW account; expired — the
 *             campaign ended before the person registered; registered — TOW
 *             account exists and is linked (HomeChef: onboarding not yet
 *             submitted); pending_review — HomeChef onboarding submitted,
 *             awaiting TOW review; inspected — TOW inspection completed,
 *             decision pending; approved / rejected / suspended — current TOW
 *             HomeChef status; closed — the TOW account no longer exists.
 *             HomeChef-only values never apply to customers.
 *         registeredAt: { type: string, format: date-time, nullable: true, description: When the person's TOW account was linked to this submission }
 *         onboardingSubmittedAt: { type: string, format: date-time, nullable: true, description: HomeChef only — when TOW onboarding was submitted }
 *         firstApprovedAt: { type: string, format: date-time, nullable: true, description: HomeChef only — first TOW approval after linking }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *       example:
 *         submissionId: psub_3f9a1c0b7e2d4a6f8b1c2d3e
 *         externalRef: fc-chef-00123
 *         type: homechef
 *         status: pending_review
 *         registeredAt: "2026-10-04T10:02:11.000Z"
 *         onboardingSubmittedAt: "2026-10-05T16:40:00.000Z"
 *         firstApprovedAt: null
 *         createdAt: "2026-10-02T09:15:00.000Z"
 *         updatedAt: "2026-10-04T10:02:11.000Z"
 *
 *     PartnerWebhookEvent:
 *       type: object
 *       description: >-
 *         Body of a webhook POST to your endpoint. Verify the signature before
 *         trusting it (see "Webhooks" in the API description). Respond with
 *         any 2xx status within 10 seconds; anything else is retried.
 *       required: [id, type, createdAt, data]
 *       properties:
 *         id: { type: string, description: "Unique event id; also sent in the TOW-Webhook-Id header. Use it to ignore duplicates.", example: evt_5b0e2c7d9a41f3e6b8c2d1a0 }
 *         type: { type: string, enum: [submission.status_changed, ping] }
 *         createdAt: { type: string, format: date-time }
 *         data:
 *           allOf:
 *             - $ref: "#/components/schemas/PartnerSubmission"
 *             - type: object
 *               required: [previousStatus, sequence]
 *               properties:
 *                 previousStatus: { type: string, example: pending_review }
 *                 sequence: { type: integer, minimum: 1, description: "Increases by 1 with every status change of this submission. Ignore an event whose sequence is not higher than the last one you processed." }
 *       example:
 *         id: evt_5b0e2c7d9a41f3e6b8c2d1a0
 *         type: submission.status_changed
 *         createdAt: "2026-10-12T14:05:09.000Z"
 *         data:
 *           submissionId: psub_3f9a1c0b7e2d4a6f8b1c2d3e
 *           externalRef: fc-user-48213
 *           type: homechef
 *           previousStatus: pending_review
 *           status: inspected
 *           sequence: 3
 *           registeredAt: "2026-10-04T10:02:11.000Z"
 *           onboardingSubmittedAt: "2026-10-05T16:40:00.000Z"
 *           firstApprovedAt: null
 *           createdAt: "2026-10-02T09:15:00.000Z"
 *           updatedAt: "2026-10-12T14:05:09.000Z"
 *
 *     PartnerSubmissionWithToken:
 *       allOf:
 *         - $ref: "#/components/schemas/PartnerSubmission"
 *         - type: object
 *           required: [claimToken]
 *           properties:
 *             claimToken: { type: string, description: "Single-use token the person enters in TOW after signing up. Returned only here — store it.", example: Xk3v9Q2LmT7rB1yH5nW8cZ0pJ4dF6gA2sE9uR3tY7iK }
 *             campaignCode: { type: string, example: FOODCLIME-CHEF }
 *
 *     PartnerSubmissionReplay:
 *       allOf:
 *         - $ref: "#/components/schemas/PartnerSubmission"
 *         - type: object
 *           properties:
 *             replayed: { type: boolean, enum: [true], description: "Same externalRef and identical details were already submitted. No claimToken is returned — use the /invite endpoint if it was lost." }
 *
 *     PartnerSubmissionCreatedResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Submission accepted }
 *         data: { $ref: "#/components/schemas/PartnerSubmissionWithToken" }
 *
 *     PartnerSubmissionReplayResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Submission already exists }
 *         data: { $ref: "#/components/schemas/PartnerSubmissionReplay" }
 *
 *     PartnerSubmissionResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Submission fetched successfully }
 *         data: { $ref: "#/components/schemas/PartnerSubmission" }
 *
 *     PartnerInviteResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Invite re-issued. Previous claim token is no longer valid. }
 *         data: { $ref: "#/components/schemas/PartnerSubmissionWithToken" }
 *
 *     PartnerSubmissionListResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Submissions fetched successfully }
 *         data:
 *           type: object
 *           required: [items, nextCursor]
 *           properties:
 *             items: { type: array, items: { $ref: "#/components/schemas/PartnerSubmission" } }
 *             nextCursor: { type: string, nullable: true, description: Pass as `cursor` to get the next page; null on the last page }
 *
 *     PartnerProfileResponse:
 *       type: object
 *       properties:
 *         status: { type: string, example: ok }
 *         message: { type: string, example: Partner profile fetched successfully }
 *         data:
 *           type: object
 *           properties:
 *             partner:
 *               type: object
 *               properties:
 *                 name: { type: string, example: FoodClime / Peace Sustainability }
 *                 slug: { type: string, example: foodclime }
 *                 status: { type: string, enum: [active, suspended] }
 *             credential:
 *               type: object
 *               properties:
 *                 keyId: { type: string, example: 9f2c41d08a7b3e15 }
 *                 scopes:
 *                   type: array
 *                   items: { type: string, enum: [partner:read, homechef:submit, homechef:read, customer:submit, customer:read] }
 *             campaigns:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   status: { type: string, enum: [active, paused, ended] }
 *                   startsAt: { type: string, format: date-time }
 *                   endsAt: { type: string, format: date-time, nullable: true }
 *                   audiences: { type: array, items: { type: string, enum: [vendor, customer] } }
 *                   customerAttributionDays: { type: integer, example: 90 }
 *                   codes:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         code: { type: string, example: FOODCLIME-CHEF }
 *                         audience: { type: string, enum: [vendor, customer, both], description: "vendor = HomeChef" }
 *                         status: { type: string, enum: [active, disabled] }
 *                         expiresAt: { type: string, format: date-time, nullable: true }
 *
 *   responses:
 *     PartnerBadRequest:
 *       description: >-
 *         Invalid request. Validation error (field issues in `error`),
 *         IDEMPOTENCY_KEY_REQUIRED, REFERRAL_CODE_INVALID,
 *         REFERRAL_CODE_DISABLED, REFERRAL_CODE_EXPIRED or
 *         REFERRAL_AUDIENCE_MISMATCH.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           examples:
 *             invalidCode:
 *               value: { status: error, message: Invalid campaign code, error: REFERRAL_CODE_INVALID }
 *             validation:
 *               value: { status: error, message: Validation error, error: [{ path: [email], message: Invalid email address, code: invalid_format }] }
 *     PartnerQueryBadRequest:
 *       description: Invalid path or query parameter (e.g. malformed externalRef, cursor or updatedSince).
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *     PartnerUnauthorized:
 *       description: >-
 *         PARTNER_UNAUTHORIZED — missing, malformed, unknown, revoked or
 *         expired API key, request from a non-allowed IP, or partner
 *         suspended (always the same response). PARTNER_SIGNATURE_INVALID —
 *         request signing is required for this key, or a signature was sent
 *         and is missing a header, stale (more than 300 seconds from server
 *         time) or does not match; the message says which.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           examples:
 *             credentials:
 *               value: { status: error, message: Invalid or missing partner credentials, error: PARTNER_UNAUTHORIZED }
 *             signature:
 *               value: { status: error, message: Request signature does not match, error: PARTNER_SIGNATURE_INVALID }
 *     PartnerForbidden:
 *       description: The API key is valid but lacks the scope this endpoint requires.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           example: { status: error, message: "This credential does not have the \"homechef:submit\" scope", error: PARTNER_FORBIDDEN_SCOPE }
 *     PartnerNotFound:
 *       description: No submission with this externalRef exists for your account.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           example: { status: error, message: Submission not found, error: RESOURCE_NOT_FOUND }
 *     PartnerSubmitConflict:
 *       description: >-
 *         DUPLICATE_EXTERNAL_REF (externalRef already used with different
 *         details), DUPLICATE_SUBMISSION (this email was already submitted;
 *         the message includes the existing externalRef) or
 *         IDEMPOTENCY_IN_PROGRESS (the first request with this key is still
 *         running — retry shortly with the same key).
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           examples:
 *             duplicateExternalRef:
 *               value: { status: error, message: externalRef already used with a different payload, error: DUPLICATE_EXTERNAL_REF }
 *             duplicateEmail:
 *               value: { status: error, message: "A homechef submission for this email already exists (externalRef: fc-chef-00099)", error: DUPLICATE_SUBMISSION }
 *     PartnerInviteConflict:
 *       description: The submission has already been claimed (RESOURCE_CONFLICT), or IDEMPOTENCY_IN_PROGRESS.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           example: { status: error, message: This submission has already been claimed, error: RESOURCE_CONFLICT }
 *     PartnerIdempotencyReused:
 *       description: The Idempotency-Key was already used for a different request.
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           example: { status: error, message: Idempotency-Key was already used with a different request, error: IDEMPOTENCY_KEY_REUSED }
 *     PartnerRateLimited:
 *       description: Too many requests — 120 per minute per API key (plus a 500 per 15 minutes per-IP ceiling). See the RateLimit-* response headers.
 *       headers:
 *         RateLimit-Remaining: { $ref: "#/components/headers/RateLimit" }
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, example: error }
 *               message: { type: string, example: Too many partner API requests. Please try again later. }
 *     PartnerServerError:
 *       description: Unexpected server error. Safe to retry (with the same Idempotency-Key for POSTs).
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/PartnerError" }
 *           example: { status: error, message: Internal Server error, error: Something went wrong. Please try again. }
 *
 * /api/v1/partner/me:
 *   get:
 *     summary: Check your API key and list your campaigns and codes
 *     description: Requires scope `partner:read`.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     responses:
 *       "200":
 *         description: Your partner profile, key scopes, campaigns and campaign codes
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerProfileResponse" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/homechefs:
 *   post:
 *     summary: Register a HomeChef lead
 *     description: >-
 *       Requires scope `homechef:submit`. Does NOT create a TOW account and
 *       does not approve anyone. Returns a single-use claimToken: the HomeChef
 *       signs up on TOW, completes TOW onboarding, and enters the token,
 *       which links their account to this submission. Approval stays entirely
 *       within TOW's own verification, inspection and admin approval.
 *       Idempotent on the Idempotency-Key header and on (externalRef, details).
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
 *         description: Submission created. Store the claimToken — it is not returned again.
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionCreatedResponse" }
 *       "200":
 *         description: >-
 *           The same externalRef was already submitted with identical details
 *           (replayed=true, no claimToken). A retry with the same
 *           Idempotency-Key instead replays the original 201 response,
 *           including the claimToken, with header Idempotent-Replayed.
 *         headers:
 *           Idempotent-Replayed: { $ref: "#/components/headers/IdempotentReplayed" }
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionReplayResponse" }
 *       "400": { $ref: "#/components/responses/PartnerBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "409": { $ref: "#/components/responses/PartnerSubmitConflict" }
 *       "422": { $ref: "#/components/responses/PartnerIdempotencyReused" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *   get:
 *     summary: List your HomeChef submissions
 *     description: >-
 *       Requires scope `homechef:read`. Ordered by last update, oldest first;
 *       page with nextCursor. With updatedSince this is a reliable backup to
 *       webhooks: every status change moves updatedAt.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerUpdatedSince"
 *       - $ref: "#/components/parameters/PartnerCursor"
 *       - $ref: "#/components/parameters/PartnerLimit"
 *     responses:
 *       "200":
 *         description: A page of submissions
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionListResponse" }
 *       "400": { $ref: "#/components/responses/PartnerQueryBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/homechefs/{externalRef}:
 *   get:
 *     summary: Get one HomeChef submission's current status
 *     description: Requires scope `homechef:read`.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerExternalRef"
 *     responses:
 *       "200":
 *         description: The submission and its current status
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionResponse" }
 *       "400": { $ref: "#/components/responses/PartnerQueryBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "404": { $ref: "#/components/responses/PartnerNotFound" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/homechefs/{externalRef}/invite:
 *   post:
 *     summary: Re-issue the claim token for an unclaimed HomeChef submission
 *     description: Requires scope `homechef:submit`. The previous claim token stops working immediately. No request body.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerExternalRef"
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     responses:
 *       "200":
 *         description: New claim token issued
 *         headers:
 *           Idempotent-Replayed: { $ref: "#/components/headers/IdempotentReplayed" }
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerInviteResponse" }
 *       "400": { $ref: "#/components/responses/PartnerBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "404": { $ref: "#/components/responses/PartnerNotFound" }
 *       "409": { $ref: "#/components/responses/PartnerInviteConflict" }
 *       "422": { $ref: "#/components/responses/PartnerIdempotencyReused" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/customers:
 *   post:
 *     summary: Register a customer lead
 *     description: >-
 *       Requires scope `customer:submit`. Same behaviour as registering a
 *       HomeChef: no TOW account is created; the customer signs up on TOW and
 *       enters the claimToken. Their orders are then attributed to your
 *       campaign for the campaign's attribution period.
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
 *         description: Submission created. Store the claimToken — it is not returned again.
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionCreatedResponse" }
 *       "200":
 *         description: Same externalRef already submitted with identical details (replayed=true, no claimToken)
 *         headers:
 *           Idempotent-Replayed: { $ref: "#/components/headers/IdempotentReplayed" }
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionReplayResponse" }
 *       "400": { $ref: "#/components/responses/PartnerBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "409": { $ref: "#/components/responses/PartnerSubmitConflict" }
 *       "422": { $ref: "#/components/responses/PartnerIdempotencyReused" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *   get:
 *     summary: List your customer submissions
 *     description: Requires scope `customer:read`.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerUpdatedSince"
 *       - $ref: "#/components/parameters/PartnerCursor"
 *       - $ref: "#/components/parameters/PartnerLimit"
 *     responses:
 *       "200":
 *         description: A page of submissions
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionListResponse" }
 *       "400": { $ref: "#/components/responses/PartnerQueryBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/customers/{externalRef}:
 *   get:
 *     summary: Get one customer submission's current status
 *     description: Requires scope `customer:read`.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerExternalRef"
 *     responses:
 *       "200":
 *         description: The submission and its current status
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerSubmissionResponse" }
 *       "400": { $ref: "#/components/responses/PartnerQueryBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "404": { $ref: "#/components/responses/PartnerNotFound" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 *
 * /api/v1/partner/customers/{externalRef}/invite:
 *   post:
 *     summary: Re-issue the claim token for an unclaimed customer submission
 *     description: Requires scope `customer:submit`. The previous claim token stops working immediately. No request body.
 *     tags: [Partner API]
 *     security: [{ partnerApiKey: [] }]
 *     parameters:
 *       - $ref: "#/components/parameters/PartnerExternalRef"
 *       - $ref: "#/components/parameters/IdempotencyKey"
 *     responses:
 *       "200":
 *         description: New claim token issued
 *         headers:
 *           Idempotent-Replayed: { $ref: "#/components/headers/IdempotentReplayed" }
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PartnerInviteResponse" }
 *       "400": { $ref: "#/components/responses/PartnerBadRequest" }
 *       "401": { $ref: "#/components/responses/PartnerUnauthorized" }
 *       "403": { $ref: "#/components/responses/PartnerForbidden" }
 *       "404": { $ref: "#/components/responses/PartnerNotFound" }
 *       "409": { $ref: "#/components/responses/PartnerInviteConflict" }
 *       "422": { $ref: "#/components/responses/PartnerIdempotencyReused" }
 *       "429": { $ref: "#/components/responses/PartnerRateLimited" }
 *       "500": { $ref: "#/components/responses/PartnerServerError" }
 */

// Isolated partner surface. Uses ONLY partner credentials — never TOW user
// cookies, roles or admin middleware — and exposes only the operations below.
class PartnerRouter {
  router: Router;
  controller: PartnerController;

  constructor() {
    this.router = Router();
    this.controller = new PartnerController();
    this.router.use(
      partnerAuthMiddleware,
      partnerSignatureMiddleware,
      partnerRateLimitMiddleware,
    );
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
