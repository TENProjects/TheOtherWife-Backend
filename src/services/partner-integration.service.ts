/** @format */

import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Attribution from "../models/attribution.model.js";
import Partner from "../models/partner.model.js";
import PartnerSubmission, {
  PartnerSubmissionDocument,
} from "../models/partnerSubmission.model.js";
import ReferralCampaign, {
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import ReferralCode from "../models/referralCode.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";

import { ALLOWED_EMAIL_DOMAINS } from "./auth.service.js";
import { AttributionService, audienceAllows } from "./attribution.service.js";

import {
  derivePartnerSubmissionStatus,
  generateInviteToken,
  generatePublicId,
  getVendorSubmittedAt,
  hashPayload,
  normalizeReferralCode,
  VendorLifecycleSnapshot,
} from "../util/referral.util.js";

export type SubmissionType = "homechef" | "customer";

export type PartnerSubmissionInput = {
  externalRef: string;
  campaignCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  state?: string;
  city?: string;
};

type PartnerContext = Express.PartnerContext;

const subjectTypeFor = (type: SubmissionType) =>
  type === "homechef" ? "vendor" : "customer";

const submissionNotFound = () =>
  new NotFoundException(
    "Submission not found",
    HttpStatus.NOT_FOUND,
    ErrorCode.RESOURCE_NOT_FOUND,
  );

type ListCursor = { u: string; i: string };

const encodeCursor = (doc: { updatedAt: Date; _id: unknown }) =>
  Buffer.from(
    JSON.stringify({ u: doc.updatedAt.toISOString(), i: String(doc._id) }),
  ).toString("base64url");

const decodeCursor = (cursor: string): ListCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed?.u === "string" &&
      !Number.isNaN(Date.parse(parsed.u)) &&
      mongoose.isValidObjectId(parsed?.i)
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
};

// Adapter between the partner API and the referral/attribution core. A
// partner can only pre-register leads and read the status of ITS OWN
// submissions; it can never create, modify or approve TOW users or vendors.
export class PartnerIntegrationService {
  private attributionService = new AttributionService();

  getProfile = async (partner: PartnerContext) => {
    const [partnerDoc, campaigns] = await Promise.all([
      Partner.findById(partner.partnerId).select("name slug status").lean(),
      ReferralCampaign.find({
        partnerId: partner.partnerId,
        status: { $in: ["active", "paused", "ended"] },
      })
        .select("name status startsAt endsAt audiences customerAttributionDays")
        .lean(),
    ]);

    const codes = await ReferralCode.find({
      campaignId: { $in: campaigns.map((c) => c._id) },
    })
      .select("code audience status expiresAt campaignId")
      .lean();

    return {
      partner: {
        name: partnerDoc?.name,
        slug: partnerDoc?.slug,
        status: partnerDoc?.status,
      },
      credential: { keyId: partner.keyId, scopes: partner.scopes },
      campaigns: campaigns.map((campaign) => ({
        name: campaign.name,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt ?? null,
        audiences: campaign.audiences,
        customerAttributionDays: campaign.customerAttributionDays,
        codes: codes
          .filter((code) => code.campaignId.equals(campaign._id as any))
          .map((code) => ({
            code: code.code,
            audience: code.audience,
            status: code.status,
            expiresAt: code.expiresAt ?? null,
          })),
      })),
    };
  };

  // Validates that campaignCode is a live code of a campaign owned by THIS
  // partner. Codes belonging to other partners/campaigns are reported as
  // simply invalid so their existence isn't disclosed.
  private resolvePartnerCode = async (
    partner: PartnerContext,
    rawCode: string,
    type: SubmissionType,
  ) => {
    const normalized = normalizeReferralCode(rawCode);
    const code = normalized ? await ReferralCode.findOne({ code: normalized }) : null;
    const campaign = code
      ? await ReferralCampaign.findById(code.campaignId)
      : null;

    if (!code || !campaign || !campaign.partnerId?.equals(partner.partnerId)) {
      throw new BadRequestException(
        "Invalid campaign code",
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERRAL_CODE_INVALID,
      );
    }

    await this.attributionService.assertCodeUsable(code, campaign);

    if (!audienceAllows(code, campaign, subjectTypeFor(type))) {
      throw new BadRequestException(
        `This campaign code is not valid for ${type} submissions`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERRAL_AUDIENCE_MISMATCH,
      );
    }

    return { code, campaign };
  };

  private assertSignupCompatibleEmail = (email: string) => {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !ALLOWED_EMAIL_DOMAINS.has(domain)) {
      throw new BadRequestException(
        `Email domain is not accepted by TOW signup. Accepted domains: ${Array.from(
          ALLOWED_EMAIL_DOMAINS,
        ).join(", ")}`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  submit = async (
    partner: PartnerContext,
    type: SubmissionType,
    input: PartnerSubmissionInput,
  ): Promise<{ httpStatus: 200 | 201; data: Record<string, unknown> }> => {
    const email = input.email.trim().toLowerCase();
    const requestHash = hashPayload({ type, ...input, email });

    const existing = await PartnerSubmission.findOne({
      partnerId: partner.partnerId,
      type,
      externalRef: input.externalRef,
    });
    if (existing) {
      return this.replayOrConflict(existing, requestHash);
    }

    this.assertSignupCompatibleEmail(email);
    const { code, campaign } = await this.resolvePartnerCode(
      partner,
      input.campaignCode,
      type,
    );

    // Same externalRef is excluded here: a concurrent identical request may
    // have inserted it a moment ago, and that case must resolve as a replay
    // (via the unique-index path below), not as a duplicate-email conflict.
    const duplicateEmail = await PartnerSubmission.findOne({
      partnerId: partner.partnerId,
      type,
      email,
      externalRef: { $ne: input.externalRef },
    }).select("externalRef");
    if (duplicateEmail) {
      throw new AppError(
        `A ${type} submission for this email already exists (externalRef: ${duplicateEmail.externalRef})`,
        HttpStatus.CONFLICT,
        ErrorCode.DUPLICATE_SUBMISSION,
      );
    }

    const { token, tokenHash } = generateInviteToken();
    const now = new Date();

    let submission: PartnerSubmissionDocument;
    try {
      submission = await PartnerSubmission.create({
        publicId: generatePublicId("psub"),
        partnerId: partner.partnerId,
        campaignId: campaign._id,
        referralCodeId: code._id,
        type,
        externalRef: input.externalRef,
        email,
        phoneNumber: input.phoneNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        state: input.state,
        city: input.city,
        requestHash,
        inviteTokenHash: tokenHash,
        credentialKeyId: partner.keyId,
        events: [
          {
            type: "submitted",
            at: now,
            actorType: "partner",
            actorId: partner.keyId,
          },
        ],
      });
    } catch (error) {
      // Concurrent retry with the same externalRef won the insert race.
      if ((error as { code?: number })?.code === 11000) {
        const winner = await PartnerSubmission.findOne({
          partnerId: partner.partnerId,
          type,
          externalRef: input.externalRef,
        });
        if (winner) return this.replayOrConflict(winner, requestHash);
      }
      throw error;
    }

    return {
      httpStatus: 201,
      data: {
        ...(await this.represent(submission, campaign)),
        // Returned once. Single-use; the person enters/opens it after signing
        // up through the normal TOW flow. Re-issue via the /invite endpoint.
        claimToken: token,
        campaignCode: code.code,
      },
    };
  };

  private replayOrConflict = async (
    existing: PartnerSubmissionDocument,
    requestHash: string,
  ): Promise<{ httpStatus: 200; data: Record<string, unknown> }> => {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        "externalRef already used with a different payload",
        HttpStatus.CONFLICT,
        ErrorCode.DUPLICATE_EXTERNAL_REF,
      );
    }
    return { httpStatus: 200, data: { ...(await this.represent(existing)), replayed: true } };
  };

  reissueInvite = async (
    partner: PartnerContext,
    type: SubmissionType,
    externalRef: string,
  ) => {
    const { token, tokenHash } = generateInviteToken();
    const submission = await PartnerSubmission.findOneAndUpdate(
      {
        partnerId: partner.partnerId,
        type,
        externalRef,
        linkedUserId: { $exists: false },
      },
      {
        $set: { inviteTokenHash: tokenHash },
        $push: {
          events: {
            type: "invite_reissued",
            at: new Date(),
            actorType: "partner",
            actorId: partner.keyId,
          },
        },
      },
      { new: true },
    );

    if (!submission) {
      const exists = await PartnerSubmission.exists({
        partnerId: partner.partnerId,
        type,
        externalRef,
      });
      if (!exists) throw submissionNotFound();
      throw new AppError(
        "This submission has already been claimed",
        HttpStatus.CONFLICT,
        ErrorCode.RESOURCE_CONFLICT,
      );
    }

    return { ...(await this.represent(submission)), claimToken: token };
  };

  getByExternalRef = async (
    partner: PartnerContext,
    type: SubmissionType,
    externalRef: string,
  ) => {
    const submission = await PartnerSubmission.findOne({
      partnerId: partner.partnerId,
      type,
      externalRef,
    });
    if (!submission) throw submissionNotFound();
    return this.represent(submission);
  };

  list = async (
    partner: PartnerContext,
    type: SubmissionType,
    options: { updatedSince?: Date; cursor?: string; limit?: number },
  ) => {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const query: Record<string, unknown> = { partnerId: partner.partnerId, type };

    const and: Record<string, unknown>[] = [];
    if (options.updatedSince) and.push({ updatedAt: { $gte: options.updatedSince } });
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      if (!cursor) {
        throw new BadRequestException(
          "Invalid cursor",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const u = new Date(cursor.u);
      const i = new mongoose.Types.ObjectId(cursor.i);
      and.push({ $or: [{ updatedAt: { $gt: u } }, { updatedAt: u, _id: { $gt: i } }] });
    }
    if (and.length) query.$and = and;

    const submissions = await PartnerSubmission.find(query)
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit + 1);

    const page = submissions.slice(0, limit);
    const items = await this.representMany(page);
    const last = page[page.length - 1];

    return {
      items,
      nextCursor: submissions.length > limit && last ? encodeCursor(last) : null,
    };
  };

  // ── Representation ────────────────────────────────────────────────────
  // Partner-facing view. Only coarse lifecycle status and timestamps — never
  // TOW ObjectIds, rejection reasons, KYC, bank or other users' data.

  private represent = async (
    submission: PartnerSubmissionDocument,
    campaign?: ReferralCampaignDocument | null,
  ) => {
    const [result] = await this.representMany([submission], campaign ? [campaign] : undefined);
    return result;
  };

  private representMany = async (
    submissions: PartnerSubmissionDocument[],
    preloadedCampaigns?: ReferralCampaignDocument[],
  ) => {
    if (!submissions.length) return [];

    const campaignIds = Array.from(
      new Set(submissions.map((s) => s.campaignId.toString())),
    );
    const campaigns =
      preloadedCampaigns ??
      ((await ReferralCampaign.find({ _id: { $in: campaignIds } })
        .select("endsAt")
        .lean()) as unknown as ReferralCampaignDocument[]);
    const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

    const linkedUserIds = submissions
      .map((s) => s.linkedUserId)
      .filter((id): id is mongoose.Types.ObjectId => !!id);
    const attributionIds = submissions
      .map((s) => s.attributionId)
      .filter((id): id is mongoose.Types.ObjectId => !!id);

    const [vendors, users, attributions] = await Promise.all([
      linkedUserIds.length
        ? Vendor.find({ userId: { $in: linkedUserIds } })
            .select("userId approvalStatus inspectionStatus approvedAt additionalData.onboarding.submittedAt")
            .lean()
        : [],
      linkedUserIds.length
        ? User.find({ _id: { $in: linkedUserIds }, status: { $ne: "deleted" } })
            .select("_id")
            .lean()
        : [],
      attributionIds.length
        ? Attribution.find({ _id: { $in: attributionIds } })
            .select("firstApprovedAt")
            .lean()
        : [],
    ]);

    const vendorByUser = new Map(vendors.map((v) => [v.userId.toString(), v]));
    const liveUsers = new Set(users.map((u) => u._id.toString()));
    const attributionById = new Map(attributions.map((a) => [a._id.toString(), a]));

    return submissions.map((submission) => {
      const userKey = submission.linkedUserId?.toString();
      const vendor = userKey ? vendorByUser.get(userKey) ?? null : null;
      const attribution = submission.attributionId
        ? attributionById.get(submission.attributionId.toString())
        : undefined;
      const status = derivePartnerSubmissionStatus({
        type: submission.type,
        linked: !!submission.linkedUserId,
        campaignEndsAt: campaignById.get(submission.campaignId.toString())?.endsAt,
        vendor: vendor as VendorLifecycleSnapshot,
        userExists: userKey ? liveUsers.has(userKey) : undefined,
      });

      return {
        submissionId: submission.publicId,
        externalRef: submission.externalRef,
        type: submission.type,
        status,
        registeredAt: submission.linkedAt ?? null,
        ...(submission.type === "homechef"
          ? {
              onboardingSubmittedAt: getVendorSubmittedAt(vendor as VendorLifecycleSnapshot),
              firstApprovedAt: attribution?.firstApprovedAt ?? null,
            }
          : {}),
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
      };
    });
  };
}

export const partnerIntegrationService = new PartnerIntegrationService();
