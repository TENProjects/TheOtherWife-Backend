/** @format */

import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";

import Attribution, { AttributionDocument } from "../models/attribution.model.js";
import Partner from "../models/partner.model.js";
import PartnerSubmission, {
  PartnerSubmissionDocument,
} from "../models/partnerSubmission.model.js";
import ReferralCampaign, {
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import ReferralCode, { ReferralCodeDocument } from "../models/referralCode.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";

import {
  addDays,
  attributionLiveState,
  DAY_MS,
  normalizeReferralCode,
  sha256Hex,
} from "../util/referral.util.js";

export type SubjectType = "vendor" | "customer";

export type ResolvedReferralCode = {
  code: ReferralCodeDocument;
  campaign: ReferralCampaignDocument;
};

const submissionTypeFor = (subjectType: SubjectType) =>
  subjectType === "vendor" ? "homechef" : "customer";

export const audienceAllows = (
  code: Pick<ReferralCodeDocument, "audience">,
  campaign: Pick<ReferralCampaignDocument, "audiences">,
  subjectType: SubjectType,
): boolean =>
  (code.audience === "both" || code.audience === subjectType) &&
  campaign.audiences.includes(subjectType);

const codeError = (
  message: string,
  errorCode:
    | typeof ErrorCode.REFERRAL_CODE_INVALID
    | typeof ErrorCode.REFERRAL_CODE_DISABLED
    | typeof ErrorCode.REFERRAL_CODE_EXPIRED,
) => new BadRequestException(message, HttpStatus.BAD_REQUEST, errorCode);

// Reusable referral/attribution core. Shared by the internal referral-link
// flow (/api/v1/referrals/*) and the partner API (/api/v1/partner/*). Nothing
// here is partner-specific; a partner is just a campaign with a partnerId.
export class AttributionService {
  // Validates that a code exists and is currently usable. Throws a
  // REFERRAL_CODE_* error otherwise.
  resolveActiveCode = async (
    rawCode: unknown,
    now: Date = new Date(),
  ): Promise<ResolvedReferralCode> => {
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized) {
      throw codeError("Invalid referral code", ErrorCode.REFERRAL_CODE_INVALID);
    }

    const code = await ReferralCode.findOne({ code: normalized });
    if (!code) {
      throw codeError("Invalid referral code", ErrorCode.REFERRAL_CODE_INVALID);
    }

    const campaign = await ReferralCampaign.findById(code.campaignId);
    await this.assertCodeUsable(code, campaign, now);

    return { code, campaign: campaign as ReferralCampaignDocument };
  };

  assertCodeUsable = async (
    code: ReferralCodeDocument,
    campaign: ReferralCampaignDocument | null,
    now: Date = new Date(),
  ) => {
    if (!campaign || campaign.status === "draft") {
      throw codeError("Invalid referral code", ErrorCode.REFERRAL_CODE_INVALID);
    }
    if (code.status !== "active" || campaign.status === "paused") {
      throw codeError(
        "This referral code is no longer active",
        ErrorCode.REFERRAL_CODE_DISABLED,
      );
    }
    if (now.getTime() < campaign.startsAt.getTime()) {
      throw codeError(
        "This referral code is not active yet",
        ErrorCode.REFERRAL_CODE_DISABLED,
      );
    }
    if (
      campaign.status === "ended" ||
      (campaign.endsAt && now.getTime() >= campaign.endsAt.getTime()) ||
      (code.expiresAt && now.getTime() >= code.expiresAt.getTime())
    ) {
      throw codeError(
        "This referral code has expired",
        ErrorCode.REFERRAL_CODE_EXPIRED,
      );
    }
    if (campaign.partnerId) {
      const partner = await Partner.findById(campaign.partnerId).select("status");
      if (!partner || partner.status !== "active") {
        throw codeError(
          "This referral code is no longer active",
          ErrorCode.REFERRAL_CODE_DISABLED,
        );
      }
    }
  };

  // Public, non-throwing validity check for the onboarding UI. Reveals only
  // the campaign's display name and audience — never partner internals.
  checkCode = async (rawCode: unknown) => {
    try {
      const { code, campaign } = await this.resolveActiveCode(rawCode);
      const exhausted =
        typeof code.maxUses === "number" && code.usedCount >= code.maxUses;
      if (exhausted) {
        return { valid: false, reason: ErrorCode.REFERRAL_CODE_EXHAUSTED };
      }
      return {
        valid: true,
        code: code.code,
        audience: code.audience,
        campaignName: campaign.name,
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { valid: false, reason: error.errorCode };
      }
      throw error;
    }
  };

  // Attributes the CURRENT authenticated user to a referral code or a
  // partner invite token. First-touch: a user can only ever be attributed
  // once. Never writes to User/Vendor/Order.
  claim = async (
    userId: string,
    input: { code?: string; inviteToken?: string },
    now: Date = new Date(),
  ) => {
    const user = await User.findById(userId).select(
      "userType createdAt status email",
    );
    if (!user) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }
    if (user.userType !== "customer" && user.userType !== "vendor") {
      throw new UnauthorizedExceptionError(
        "Only customer and vendor accounts can be attributed",
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
      );
    }
    const subjectType = user.userType as SubjectType;

    if (await Attribution.exists({ subjectUserId: user._id })) {
      throw new AppError(
        "This account has already been attributed to a referral",
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_ATTRIBUTED,
      );
    }

    // ── Resolve code (+ optional partner submission) ────────────────────
    let resolved: ResolvedReferralCode;
    let submission: PartnerSubmissionDocument | null = null;
    let channel: "link" | "partner_invite" = "link";

    if (input.inviteToken) {
      submission = await PartnerSubmission.findOne({
        inviteTokenHash: sha256Hex(input.inviteToken),
      });
      if (!submission || submission.linkedUserId) {
        throw codeError(
          "Invalid or already used invite",
          ErrorCode.REFERRAL_CODE_INVALID,
        );
      }
      if (submission.type !== submissionTypeFor(subjectType)) {
        throw new BadRequestException(
          "This invite is not valid for this type of account",
          HttpStatus.BAD_REQUEST,
          ErrorCode.REFERRAL_AUDIENCE_MISMATCH,
        );
      }
      const code = await ReferralCode.findById(submission.referralCodeId);
      if (!code) {
        throw codeError("Invalid referral code", ErrorCode.REFERRAL_CODE_INVALID);
      }
      const campaign = await ReferralCampaign.findById(code.campaignId);
      await this.assertCodeUsable(code, campaign, now);
      resolved = { code, campaign: campaign as ReferralCampaignDocument };
      channel = "partner_invite";
    } else {
      resolved = await this.resolveActiveCode(input.code, now);
      // Email-match fallback: if this campaign's partner pre-registered this
      // exact email and nobody has claimed it yet, link it so the partner's
      // externalRef reconciles. Scoped to the same campaign only.
      if (resolved.campaign.partnerId) {
        submission = await PartnerSubmission.findOne({
          campaignId: resolved.campaign._id,
          type: submissionTypeFor(subjectType),
          email: user.email,
          linkedUserId: { $exists: false },
        });
      }
    }

    const { code, campaign } = resolved;

    if (!audienceAllows(code, campaign, subjectType)) {
      throw new BadRequestException(
        "This referral code is not valid for this type of account",
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERRAL_AUDIENCE_MISMATCH,
      );
    }

    if (code.ownerUserId && code.ownerUserId.equals(user._id as any)) {
      throw new BadRequestException(
        "You cannot use your own referral code",
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERRAL_SELF,
      );
    }

    // Only NEW accounts: created on/after the campaign start and within the
    // campaign's claim window. Existing TOW users are never retro-attributed.
    const userCreatedAt = (user as any).createdAt as Date | undefined;
    const claimWindowMs = campaign.claimWindowDays * DAY_MS;
    if (
      !userCreatedAt ||
      userCreatedAt.getTime() < campaign.startsAt.getTime() ||
      now.getTime() - userCreatedAt.getTime() > claimWindowMs
    ) {
      throw new BadRequestException(
        "Referral codes can only be applied to newly created accounts",
        HttpStatus.BAD_REQUEST,
        ErrorCode.ATTRIBUTION_WINDOW_CLOSED,
      );
    }

    let vendor: { _id: mongoose.Types.ObjectId; approvedAt?: Date } | null = null;
    if (subjectType === "vendor") {
      vendor = await Vendor.findOne({ userId: user._id })
        .select("_id approvedAt")
        .lean<{ _id: mongoose.Types.ObjectId; approvedAt?: Date }>();
    }

    // ── Writes (atomic per document, compensated on failure) ────────────
    const reserved = await ReferralCode.findOneAndUpdate(
      {
        _id: code._id,
        $or: [
          { maxUses: { $exists: false } },
          { maxUses: null },
          { $expr: { $lt: ["$usedCount", "$maxUses"] } },
        ],
      },
      { $inc: { usedCount: 1 } },
      { new: true },
    );
    if (!reserved) {
      throw new BadRequestException(
        "This referral code has reached its usage limit",
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERRAL_CODE_EXHAUSTED,
      );
    }
    const releaseCode = () =>
      ReferralCode.updateOne(
        { _id: code._id, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
      ).catch((error) =>
        console.error("Failed to release referral code use", error),
      );

    const attributionId = new mongoose.Types.ObjectId();
    let linkedSubmission: PartnerSubmissionDocument | null = null;

    if (submission) {
      linkedSubmission = await PartnerSubmission.findOneAndUpdate(
        { _id: submission._id, linkedUserId: { $exists: false } },
        {
          $set: { linkedUserId: user._id, attributionId, linkedAt: now },
          $push: {
            events: {
              type: "linked",
              at: now,
              actorType: "user",
              actorId: user._id.toString(),
              data: { channel },
            },
          },
        },
        { new: true },
      );
      if (!linkedSubmission && channel === "partner_invite") {
        await releaseCode();
        throw codeError(
          "Invalid or already used invite",
          ErrorCode.REFERRAL_CODE_INVALID,
        );
      }
    }

    const unlinkSubmission = () =>
      linkedSubmission
        ? PartnerSubmission.updateOne(
            { _id: linkedSubmission._id, linkedUserId: user._id },
            { $unset: { linkedUserId: 1, attributionId: 1, linkedAt: 1 } },
          ).catch((error) =>
            console.error("Failed to unlink partner submission", error),
          )
        : Promise.resolve();

    let attribution: AttributionDocument;
    try {
      attribution = await Attribution.create({
        _id: attributionId,
        subjectUserId: user._id,
        subjectType,
        vendorId: vendor?._id,
        campaignId: campaign._id,
        partnerId: campaign.partnerId,
        referralCodeId: code._id,
        codeSnapshot: code.code,
        programType: campaign.programType,
        referrerUserId: code.ownerUserId,
        channel,
        partnerSubmissionId: linkedSubmission?._id,
        externalRef: linkedSubmission?.externalRef,
        attributedAt: now,
        expiresAt:
          subjectType === "customer"
            ? addDays(now, campaign.customerAttributionDays)
            : undefined,
        status: "active",
        firstApprovedAt: vendor?.approvedAt ?? undefined,
        actorType: "user",
        actorId: user._id.toString(),
        events: [
          {
            type: "attributed",
            at: now,
            actorType: "user",
            actorId: user._id.toString(),
            data: { code: code.code, channel },
          },
        ],
      });
    } catch (error) {
      await unlinkSubmission();
      await releaseCode();
      if ((error as { code?: number })?.code === 11000) {
        throw new AppError(
          "This account has already been attributed to a referral",
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_ATTRIBUTED,
        );
      }
      throw error;
    }

    return {
      attributed: true,
      campaignName: campaign.name,
      subjectType,
      attributedAt: attribution.attributedAt,
      expiresAt: attribution.expiresAt ?? null,
    };
  };

  getMyAttribution = async (userId: string) => {
    const attribution = await Attribution.findOne({ subjectUserId: userId })
      .select("subjectType campaignId attributedAt expiresAt status codeSnapshot")
      .lean<AttributionDocument>();

    if (!attribution) {
      return { attributed: false };
    }

    const campaign = await ReferralCampaign.findById(attribution.campaignId)
      .select("name")
      .lean<{ name: string }>();

    return {
      attributed: true,
      campaignName: campaign?.name ?? null,
      code: attribution.codeSnapshot,
      subjectType: attribution.subjectType,
      attributedAt: attribution.attributedAt,
      expiresAt: attribution.expiresAt ?? null,
      state: attributionLiveState(attribution),
    };
  };

  // Subscriber target for the EXISTING vendor.approved signal. Idempotent:
  // only the first approval after attribution is stamped; re-approvals after
  // a suspension never overwrite it.
  // Agreed rule: a campaign's HomeChef window (rules.homechef.windowDays)
  // opens at the first approval of one of its HomeChefs. Atomic — only the
  // first call sets it; an admin-set start date is never overwritten.
  openHomechefWindowIfNeeded = async (
    campaignId: mongoose.Types.ObjectId,
    at: Date,
  ) => {
    const campaign = await ReferralCampaign.findById(campaignId)
      .select("rules windowStartsAt")
      .lean<{ rules?: { homechef?: { windowDays: number } }; windowStartsAt?: Date }>();
    const windowDays = campaign?.rules?.homechef?.windowDays;
    if (!windowDays || campaign?.windowStartsAt) return;
    await ReferralCampaign.updateOne(
      { _id: campaignId, windowStartsAt: { $exists: false } },
      { $set: { windowStartsAt: at, windowEndsAt: addDays(at, windowDays) } },
    );
  };

  recordVendorApproval = async (vendorId: string, at: Date = new Date()) => {
    if (!mongoose.isValidObjectId(vendorId)) return;
    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);

    const attribution = await Attribution.findOneAndUpdate(
      {
        vendorId: vendorObjectId,
        subjectType: "vendor",
        firstApprovedAt: { $exists: false },
      },
      {
        $set: { firstApprovedAt: at },
        $push: {
          events: { type: "vendor.first_approved", at, actorType: "system" },
        },
      },
      { new: true },
    ).select("partnerSubmissionId campaignId");

    if (attribution) {
      await this.openHomechefWindowIfNeeded(attribution.campaignId, at);
    }

    if (attribution?.partnerSubmissionId) {
      // Touch the submission so partners polling with updatedSince see it.
      await PartnerSubmission.updateOne(
        { _id: attribution.partnerSubmissionId },
        {
          $push: {
            events: { type: "vendor.first_approved", at, actorType: "system" },
          },
        },
      );
    }
  };
}

export const attributionService = new AttributionService();
