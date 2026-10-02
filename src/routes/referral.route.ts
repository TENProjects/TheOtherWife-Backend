/** @format */

import { Request, Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { ReferralController } from "../controllers/referral.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { claimReferralSchema } from "../zod-schema/referral.schema.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     ReferralCodeCheck:
 *       type: object
 *       properties:
 *         valid: { type: boolean }
 *         code: { type: string, example: FOODCLINE }
 *         audience: { type: string, enum: [vendor, customer, both] }
 *         campaignName: { type: string }
 *         reason:
 *           type: string
 *           description: Present when valid is false.
 *           enum: [REFERRAL_CODE_INVALID, REFERRAL_CODE_DISABLED, REFERRAL_CODE_EXPIRED, REFERRAL_CODE_EXHAUSTED]
 *     ReferralClaimRequest:
 *       type: object
 *       description: Provide exactly one of code or inviteToken.
 *       properties:
 *         code: { type: string, minLength: 4, maxLength: 32, example: FOODCLINE }
 *         inviteToken: { type: string, description: Single-use claim token issued to a partner for a pre-registered lead }
 *     ReferralAttribution:
 *       type: object
 *       properties:
 *         attributed: { type: boolean }
 *         campaignName: { type: string, nullable: true }
 *         code: { type: string }
 *         subjectType: { type: string, enum: [vendor, customer] }
 *         attributedAt: { type: string, format: date-time }
 *         expiresAt: { type: string, format: date-time, nullable: true, description: Customers only — end of the order-attribution window }
 *         state: { type: string, enum: [active, expired, revoked] }
 *
 * /api/v1/referrals/codes/{code}:
 *   get:
 *     summary: Check whether a referral code is currently valid
 *     description: >-
 *       Public. Never throws for an unknown/disabled/expired code — returns
 *       valid=false with a reason instead. Reveals only the campaign display
 *       name and audience. A referral code is an attribution identifier, not
 *       a credential.
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Validity result
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data: { $ref: "#/components/schemas/ReferralCodeCheck" }
 *       "429":
 *         description: Too many requests
 *
 * /api/v1/referrals/claim:
 *   post:
 *     summary: Attribute the current (newly created) account to a referral code or partner invite
 *     description: >-
 *       Call right after a successful customer signup / Google sign-in or
 *       vendor onboarding step 1. First-touch: an account can be attributed
 *       only once. Only accounts created after the campaign started and
 *       within the campaign's claim window are eligible — existing accounts
 *       are never retro-attributed. Does not change the user, vendor, order
 *       or wallet in any way.
 *     tags: [Referrals]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ReferralClaimRequest" }
 *     responses:
 *       "201":
 *         description: Attribution recorded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data: { $ref: "#/components/schemas/ReferralAttribution" }
 *       "400":
 *         description: >-
 *           Validation error, or REFERRAL_CODE_INVALID / REFERRAL_CODE_DISABLED /
 *           REFERRAL_CODE_EXPIRED / REFERRAL_CODE_EXHAUSTED /
 *           REFERRAL_AUDIENCE_MISMATCH / REFERRAL_SELF / ATTRIBUTION_WINDOW_CLOSED
 *       "401":
 *         description: Not logged in
 *       "403":
 *         description: Admin accounts cannot be attributed
 *       "409":
 *         description: ALREADY_ATTRIBUTED
 *
 * /api/v1/referrals/me:
 *   get:
 *     summary: Get the current user's referral attribution, if any
 *     tags: [Referrals]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       "200":
 *         description: Attribution (or attributed=false)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data: { $ref: "#/components/schemas/ReferralAttribution" }
 *       "401":
 *         description: Not logged in
 */

const referralCodeCheckRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { status: "error", message: "Too many requests. Please try again later." },
});

// Keyed per user (authMiddleware runs first) to stop invite-token guessing.
const referralClaimRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.user?._id?.toString() ?? (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  validate: { xForwardedForHeader: false },
  message: { status: "error", message: "Too many attempts. Please try again later." },
});

class ReferralRouter {
  router: Router;
  controller: ReferralController;

  constructor() {
    this.router = Router();
    this.controller = new ReferralController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/codes/:code",
      referralCodeCheckRateLimit,
      this.controller.checkCode,
    );
    this.router.post(
      "/claim",
      authMiddleware,
      roleGuardMiddleware(["customer", "vendor"]),
      referralClaimRateLimit,
      zodValidation(claimReferralSchema),
      this.controller.claim,
    );
    this.router.get(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["customer", "vendor"]),
      this.controller.getMine,
    );
  }
}

export const referralRouter = new ReferralRouter().router;
