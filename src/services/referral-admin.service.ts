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
  CampaignRules,
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import PartnerSettlement from "../models/partnerSettlement.model.js";
import ReferralCode from "../models/referralCode.model.js";
import User from "../models/user.model.js";

import { paginate, Pagination, paginationResult } from "../util/pagination.util.js";
import {
  generateSigningSecret,
  isSecretBoxConfigured,
  sealSecret,
} from "../util/secret-box.util.js";
import {
  attributionLiveState,
  normalizeIp,
  generatePartnerApiKey,
  generateReferralCode,
  normalizeReferralCode,
} from "../util/referral.util.js";

type ListResult<T> = {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

  listPartners = async (
    filters: Pagination & { status?: "active" | "suspended"; search?: string },
  ): Promise<ListResult<Record<string, unknown>>> => {
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.search) {
      const pattern = new RegExp(escapeRegex(filters.search), "i");
      query.$or = [{ name: pattern }, { slug: pattern }];
    }
    const [items, total] = await Promise.all([
      Partner.find(query).select("-webhook.secretCiphertext").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Partner.countDocuments(query),
    ]);
    return { items: items as Array<Record<string, unknown>>, pagination: paginationResult(page, limit, total) };
  };

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
      rules?: CampaignRules;
    },
  ) => {
    await this.validateCampaignShape(body);
    return ReferralCampaign.create({ ...body, createdBy: adminUserId });
  };

  listCampaigns = async (
    filters: Pagination & { partnerId?: string; status?: string },
  ): Promise<ListResult<Record<string, unknown>>> => {
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = {};
    if (filters.partnerId) {
      assertObjectId(filters.partnerId, "partner");
      query.partnerId = filters.partnerId;
    }
    if (filters.status) query.status = filters.status;
    const [items, total] = await Promise.all([
      ReferralCampaign.find(query)
        .select("-qualificationLockUntil")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReferralCampaign.countDocuments(query),
    ]);
    return { items: items as Array<Record<string, unknown>>, pagination: paginationResult(page, limit, total) };
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
      rules: CampaignRules;
      windowStartsAt: Date | null;
      windowEndsAt: Date | null;
    }>,
  ) => {
    const campaign = await this.getCampaign(campaignId);
    // customerAttributionDays only affects attributions created AFTER the
    // change — existing attributions keep the expiresAt stamped at claim time.
    const { endsAt, rules, windowStartsAt, windowEndsAt, ...rest } = body;

    // Money rules are locked once anything has been settled, so a recorded
    // settlement can never disagree with the campaign's current rules.
    if (rules !== undefined && (await PartnerSettlement.exists({ campaignId: campaign._id }))) {
      throw conflict("Campaign rules are locked once a settlement has been finalized");
    }

    Object.assign(campaign, rest);
    if (rules !== undefined) campaign.set("rules", rules);
    if (endsAt === null) {
      campaign.set("endsAt", undefined);
    } else if (endsAt) {
      campaign.endsAt = endsAt;
    }

    // Admin override of the HomeChef window. Setting only the start derives
    // the end from rules.homechef.windowDays; null clears (re-opens on the
    // next approval).
    if (windowStartsAt === null) {
      campaign.set("windowStartsAt", undefined);
      campaign.set("windowEndsAt", undefined);
    } else if (windowStartsAt) {
      campaign.windowStartsAt = windowStartsAt;
      const days = campaign.rules?.homechef?.windowDays;
      if (windowEndsAt) campaign.windowEndsAt = windowEndsAt;
      else if (days) campaign.windowEndsAt = new Date(windowStartsAt.getTime() + days * 24 * 60 * 60 * 1000);
    } else if (windowEndsAt) {
      campaign.windowEndsAt = windowEndsAt;
    }
    if (
      campaign.windowStartsAt &&
      campaign.windowEndsAt &&
      campaign.windowEndsAt.getTime() <= campaign.windowStartsAt.getTime()
    ) {
      throw new BadRequestException(
        "windowEndsAt must be after windowStartsAt",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
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

  listCodes = async (
    campaignId: string,
    filters: Pagination & { status?: "active" | "disabled" },
  ): Promise<ListResult<Record<string, unknown>>> => {
    await this.getCampaign(campaignId);
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = { campaignId };
    if (filters.status) query.status = filters.status;
    const [items, total] = await Promise.all([
      ReferralCode.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ReferralCode.countDocuments(query),
    ]);
    return { items: items as Array<Record<string, unknown>>, pagination: paginationResult(page, limit, total) };
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

  private credentialView = (credential: {
    keyId: string;
    label?: string;
    scopes: PartnerScope[];
    status: string;
    expiresAt?: Date;
    ipAllowlist: string[];
    requireSignature?: boolean;
    signingSecretCiphertext?: string;
    createdAt: Date;
    lastUsedAt?: Date;
  }) => ({
    keyId: credential.keyId,
    label: credential.label,
    scopes: credential.scopes,
    status: credential.status,
    expiresAt: credential.expiresAt ?? null,
    ipAllowlist: credential.ipAllowlist,
    requireSignature: credential.requireSignature === true,
    hasSigningSecret: !!credential.signingSecretCiphertext,
    lastUsedAt: credential.lastUsedAt ?? null,
    createdAt: credential.createdAt,
  });

  private normalizeAllowlist = (entries: string[] | undefined): string[] => {
    const normalized = (entries ?? []).map((entry) => {
      const ip = normalizeIp(entry);
      if (!ip) {
        throw new BadRequestException(
          `Invalid IP address in ipAllowlist: ${entry}`,
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      return ip;
    });
    return Array.from(new Set(normalized));
  };

  issueCredential = async (
    adminUserId: string,
    partnerId: string,
    body: {
      scopes: PartnerScope[];
      label?: string;
      expiresAt?: Date;
      ipAllowlist?: string[];
      requireSignature?: boolean;
    },
  ) => {
    const partner = await this.getPartner(partnerId);
    const { keyId, apiKey, secretHash } = generatePartnerApiKey();

    // A request-signing secret is issued alongside the key whenever the
    // server can store it (PARTNER_SECRETS_KEY set). Requiring signatures
    // without one is impossible, so that combination is rejected.
    const signingSecret = isSecretBoxConfigured() ? generateSigningSecret("tow_sk") : null;
    if (body.requireSignature && !signingSecret) {
      throw new BadRequestException(
        "Request signing is unavailable: PARTNER_SECRETS_KEY is not configured on this server",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const credential = await PartnerCredential.create({
      partnerId: partner._id,
      keyId,
      secretHash,
      label: body.label,
      scopes: Array.from(new Set(body.scopes)),
      expiresAt: body.expiresAt,
      ipAllowlist: this.normalizeAllowlist(body.ipAllowlist),
      requireSignature: body.requireSignature === true,
      signingSecretCiphertext: signingSecret ? sealSecret(signingSecret) : undefined,
      createdBy: adminUserId,
    });

    // apiKey and signingSecret are returned exactly once — neither can be
    // retrieved afterwards.
    return {
      apiKey,
      signingSecret,
      credential: this.credentialView({
        ...credential.toObject(),
        signingSecretCiphertext: credential.signingSecretCiphertext,
      }),
    };
  };

  // Changes signing enforcement and/or the IP allow-list without re-issuing
  // the key. An empty ipAllowlist removes the IP restriction.
  updateCredential = async (
    partnerId: string,
    keyId: string,
    body: { requireSignature?: boolean; ipAllowlist?: string[] },
  ) => {
    const credential = await PartnerCredential.findOne({ partnerId, keyId }).select(
      "+signingSecretCiphertext",
    );
    if (!credential) throw notFound("Credential");
    if (credential.status !== "active") {
      throw conflict("Revoked credentials cannot be changed");
    }
    if (body.requireSignature === true && !credential.signingSecretCiphertext) {
      throw new BadRequestException(
        "Generate a signing secret for this key before requiring signatures",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (body.requireSignature !== undefined) credential.requireSignature = body.requireSignature;
    if (body.ipAllowlist !== undefined) credential.ipAllowlist = this.normalizeAllowlist(body.ipAllowlist);
    await credential.save();
    return { credential: this.credentialView(credential.toObject()) };
  };

  // Generates (or replaces) the request-signing secret. The old secret stops
  // working immediately. Returned once.
  rotateSigningSecret = async (partnerId: string, keyId: string) => {
    const credential = await PartnerCredential.findOne({ partnerId, keyId, status: "active" });
    if (!credential) throw notFound("Credential");
    const signingSecret = generateSigningSecret("tow_sk");
    credential.signingSecretCiphertext = sealSecret(signingSecret);
    await credential.save();
    return {
      signingSecret,
      credential: this.credentialView(credential.toObject()),
    };
  };

  listCredentials = async (
    partnerId: string,
    filters: Pagination & { status?: "active" | "revoked" },
  ) => {
    await this.getPartner(partnerId);
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = { partnerId };
    if (filters.status) query.status = filters.status;
    // signingSecretCiphertext is loaded only to report hasSigningSecret;
    // credentialView never returns it.
    const [credentials, total] = await Promise.all([
      PartnerCredential.find(query)
        .select("+signingSecretCiphertext")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PartnerCredential.countDocuments(query),
    ]);
    return {
      items: credentials.map((credential) => this.credentialView(credential as any)),
      pagination: paginationResult(page, limit, total),
    };
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
      qualified?: boolean;
    },
  ): Promise<ListResult<Record<string, unknown>>> => {
    const { page, limit, skip } = paginate(filters);
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
    if (filters.qualified !== undefined) {
      query.qualifiedAt = { $exists: filters.qualified };
    }

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
        .limit(limit)
        .populate("subjectUserId", "firstName lastName email userType status")
        .lean(),
      Attribution.countDocuments(query),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        state: attributionLiveState(row as any, now),
      })),
      pagination: paginationResult(page, limit, total),
    };
  };
}

export const referralAdminService = new ReferralAdminService();
