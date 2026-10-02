/** @format */

import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Attribution from "../models/attribution.model.js";
import Partner, { PartnerDocument } from "../models/partner.model.js";
import PartnerCredential, {
  PartnerScope,
} from "../models/partnerCredential.model.js";
import ReferralCampaign, {
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import ReferralCode from "../models/referralCode.model.js";
import User from "../models/user.model.js";

import {
  attributionLiveState,
  generatePartnerApiKey,
  generateReferralCode,
  normalizeReferralCode,
} from "../util/referral.util.js";

type Pagination = { page?: number; limit?: number };

const paginate = ({ page = 1, limit = 20 }: Pagination) => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};

const notFound = (what: string) =>
  new NotFoundException(
    `${what} not found`,
    HttpStatus.NOT_FOUND,
    ErrorCode.RESOURCE_NOT_FOUND,
  );

const assertObjectId = (id: string, what: string) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new BadRequestException(
      `Invalid ${what} id`,
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    );
  }
};

const conflict = (message: string) =>
  new AppError(message, HttpStatus.CONFLICT, ErrorCode.RESOURCE_CONFLICT);

const isDuplicateKey = (error: unknown) =>
  (error as { code?: number })?.code === 11000;

// Admin management of the referral/attribution core: partners, campaigns,
// codes, partner API credentials, and the attribution list. Every mutation is
// audit-logged by the controller through the existing logAdminAction.
export class ReferralAdminService {
  // ── Partners ──────────────────────────────────────────────────────────

  createPartner = async (
    adminUserId: string,
    body: { name: string; slug: string; contactEmail?: string; notes?: string },
  ) => {
    try {
      return await Partner.create({ ...body, createdBy: adminUserId });
    } catch (error) {
      if (isDuplicateKey(error)) throw conflict("A partner with this slug already exists");
      throw error;
    }
  };

  listPartners = async () =>
    Partner.find().sort({ createdAt: -1 }).limit(200).lean();

  getPartner = async (partnerId: string) => {
    assertObjectId(partnerId, "partner");
    const partner = await Partner.findById(partnerId);
    if (!partner) throw notFound("Partner");
    return partner;
  };

  updatePartner = async (
    partnerId: string,
    body: Partial<Pick<PartnerDocument, "name" | "status" | "contactEmail" | "notes">>,
  ) => {
    const partner = await this.getPartner(partnerId);
    Object.assign(partner, body);
    await partner.save();
    return partner;
  };

  // ── Campaigns ─────────────────────────────────────────────────────────

  private validateCampaignShape = async (campaign: {
    programType: string;
    partnerId?: unknown;
    startsAt: Date;
    endsAt?: Date | null;
  }) => {
    if (campaign.programType === "partner") {
      if (!campaign.partnerId) {
        throw new BadRequestException(
          "partnerId is required for partner campaigns",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      await this.getPartner(String(campaign.partnerId));
    } else if (campaign.partnerId) {
      throw new BadRequestException(
        "partnerId is only allowed for partner campaigns",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (campaign.endsAt && campaign.endsAt.getTime() <= campaign.startsAt.getTime()) {
      throw new BadRequestException(
        "endsAt must be after startsAt",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  createCampaign = async (
    adminUserId: string,
    body: {
      name: string;
      description?: string;
      programType: "internal_user" | "partner" | "campaign";
      partnerId?: string;
      status?: "draft" | "active" | "paused" | "ended";
      startsAt: Date;
      endsAt?: Date;
      audiences: Array<"vendor" | "customer">;
      customerAttributionDays?: number;
      claimWindowDays?: number;
      targets?: { homechefs?: number; customers?: number };
    },
  ) => {
    await this.validateCampaignShape(body);
    return ReferralCampaign.create({ ...body, createdBy: adminUserId });
  };

  listCampaigns = async (filters: { partnerId?: string; status?: string }) => {
    const query: Record<string, unknown> = {};
    if (filters.partnerId) {
      assertObjectId(filters.partnerId, "partner");
      query.partnerId = filters.partnerId;
    }
    if (filters.status) query.status = filters.status;
    return ReferralCampaign.find(query).sort({ createdAt: -1 }).limit(200).lean();
  };

  getCampaign = async (campaignId: string): Promise<ReferralCampaignDocument> => {
    assertObjectId(campaignId, "campaign");
    const campaign = await ReferralCampaign.findById(campaignId);
    if (!campaign) throw notFound("Campaign");
    return campaign;
  };

  updateCampaign = async (
    campaignId: string,
    body: Partial<{
      name: string;
      description: string;
      status: "draft" | "active" | "paused" | "ended";
      startsAt: Date;
      endsAt: Date | null;
      audiences: Array<"vendor" | "customer">;
      customerAttributionDays: number;
      claimWindowDays: number;
      targets: { homechefs?: number; customers?: number };
    }>,
  ) => {
    const campaign = await this.getCampaign(campaignId);
    // customerAttributionDays only affects attributions created AFTER the
    // change — existing attributions keep the expiresAt stamped at claim time.
    const { endsAt, ...rest } = body;
    Object.assign(campaign, rest);
    if (endsAt === null) {
      campaign.set("endsAt", undefined);
    } else if (endsAt) {
      campaign.endsAt = endsAt;
    }
    await this.validateCampaignShape(campaign);
    await campaign.save();
    return campaign;
  };

  // ── Codes ─────────────────────────────────────────────────────────────

  createCode = async (
    adminUserId: string,
    campaignId: string,
    body: {
      code?: string;
      audience: "vendor" | "customer" | "both";
      expiresAt?: Date;
      maxUses?: number;
      ownerUserId?: string;
      label?: string;
    },
  ) => {
    const campaign = await this.getCampaign(campaignId);

    const audiencesNeeded =
      body.audience === "both" ? ["vendor", "customer"] : [body.audience];
    if (!audiencesNeeded.every((a) => campaign.audiences.includes(a as any))) {
      throw new BadRequestException(
        "Code audience must be within the campaign's audiences",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (body.ownerUserId) {
      if (campaign.programType !== "internal_user") {
        throw new BadRequestException(
          "ownerUserId is only allowed on internal_user campaigns",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      assertObjectId(body.ownerUserId, "owner user");
      if (!(await User.exists({ _id: body.ownerUserId }))) throw notFound("Owner user");
    }

    let code: string | null;
    if (body.code) {
      code = normalizeReferralCode(body.code);
      if (!code) {
        throw new BadRequestException(
          "Code must be 4-32 characters: letters, digits and single hyphens",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
    } else {
      code = null;
    }

    // Generated codes retry on the (astronomically unlikely) collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await ReferralCode.create({
          code: code ?? generateReferralCode(),
          campaignId: campaign._id,
          audience: body.audience,
          expiresAt: body.expiresAt,
          maxUses: body.maxUses,
          ownerUserId: body.ownerUserId,
          label: body.label,
          createdBy: adminUserId,
        });
      } catch (error) {
        if (isDuplicateKey(error)) {
          if (code) throw conflict("This referral code already exists");
          continue;
        }
        throw error;
      }
    }
    throw conflict("Could not generate a unique referral code, please retry");
  };

  listCodes = async (campaignId: string) => {
    await this.getCampaign(campaignId);
    return ReferralCode.find({ campaignId }).sort({ createdAt: -1 }).lean();
  };

  updateCode = async (
    campaignId: string,
    codeId: string,
    body: Partial<{
      status: "active" | "disabled";
      expiresAt: Date | null;
      maxUses: number | null;
      label: string;
    }>,
  ) => {
    assertObjectId(codeId, "code");
    const code = await ReferralCode.findOne({ _id: codeId, campaignId });
    if (!code) throw notFound("Referral code");
    if (body.status) code.status = body.status;
    if (body.label !== undefined) code.label = body.label;
    if (body.expiresAt === null) code.set("expiresAt", undefined);
    else if (body.expiresAt) code.expiresAt = body.expiresAt;
    if (body.maxUses === null) code.set("maxUses", undefined);
    else if (typeof body.maxUses === "number") code.maxUses = body.maxUses;
    await code.save();
    return code;
  };

  // ── Partner credentials ───────────────────────────────────────────────

  issueCredential = async (
    adminUserId: string,
    partnerId: string,
    body: {
      scopes: PartnerScope[];
      label?: string;
      expiresAt?: Date;
      ipAllowlist?: string[];
    },
  ) => {
    const partner = await this.getPartner(partnerId);
    const { keyId, apiKey, secretHash } = generatePartnerApiKey();

    const credential = await PartnerCredential.create({
      partnerId: partner._id,
      keyId,
      secretHash,
      label: body.label,
      scopes: Array.from(new Set(body.scopes)),
      expiresAt: body.expiresAt,
      ipAllowlist: body.ipAllowlist ?? [],
      createdBy: adminUserId,
    });

    // apiKey is returned exactly once — it is not recoverable afterwards.
    return {
      apiKey,
      credential: {
        keyId: credential.keyId,
        label: credential.label,
        scopes: credential.scopes,
        status: credential.status,
        expiresAt: credential.expiresAt ?? null,
        ipAllowlist: credential.ipAllowlist,
        createdAt: credential.createdAt,
      },
    };
  };

  listCredentials = async (partnerId: string) => {
    await this.getPartner(partnerId);
    return PartnerCredential.find({ partnerId })
      .select("-secretHash")
      .sort({ createdAt: -1 })
      .lean();
  };

  revokeCredential = async (
    adminUserId: string,
    partnerId: string,
    keyId: string,
  ) => {
    const credential = await PartnerCredential.findOneAndUpdate(
      { partnerId, keyId },
      {
        $set: { status: "revoked", revokedBy: adminUserId, revokedAt: new Date() },
      },
      { new: true },
    ).select("-secretHash");
    if (!credential) throw notFound("Credential");
    return credential;
  };

  // ── Attributions ──────────────────────────────────────────────────────

  listAttributions = async (
    filters: Pagination & {
      campaignId?: string;
      partnerId?: string;
      subjectType?: "vendor" | "customer";
      state?: "active" | "expired" | "revoked";
    },
  ): Promise<{
    attributions: Array<Record<string, unknown>>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> => {
    const { safeLimit, safePage, skip } = paginate(filters);
    const query: Record<string, unknown> = {};
    if (filters.campaignId) {
      assertObjectId(filters.campaignId, "campaign");
      query.campaignId = filters.campaignId;
    }
    if (filters.partnerId) {
      assertObjectId(filters.partnerId, "partner");
      query.partnerId = filters.partnerId;
    }
    if (filters.subjectType) query.subjectType = filters.subjectType;

    const now = new Date();
    if (filters.state === "revoked") {
      query.status = "revoked";
    } else if (filters.state === "expired") {
      query.status = "active";
      query.expiresAt = { $lte: now };
    } else if (filters.state === "active") {
      query.status = "active";
      query.$or = [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }];
    }

    const [rows, total] = await Promise.all([
      Attribution.find(query)
        .select("-events")
        .sort({ attributedAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate("subjectUserId", "firstName lastName email userType status")
        .lean(),
      Attribution.countDocuments(query),
    ]);

    return {
      attributions: rows.map((row) => ({
        ...row,
        state: attributionLiveState(row as any, now),
      })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };
}

export const referralAdminService = new ReferralAdminService();
