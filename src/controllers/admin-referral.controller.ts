/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";
import { ReferralAdminService } from "../services/referral-admin.service.js";
import { ReferralReportingService } from "../services/referral-reporting.service.js";
import {
  campaignMetricsQuerySchema,
  listAttributionsQuerySchema,
  listCampaignsQuerySchema,
} from "../zod-schema/referral.schema.js";

const ok = (res: Response, message: string, data: unknown, status: number = HttpStatus.OK) =>
  res.status(status).json({ status: "ok", message, data } as ApiResponse);

const audit = (
  req: Request<any, any, any, any>,
  action: string,
  targetType: string,
  targetId: string | undefined,
  metadata?: Record<string, unknown>,
) =>
  logAdminAction({
    adminUserId: req.user?._id as unknown as string,
    action,
    targetType,
    targetId,
    metadata,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });

export class AdminReferralController {
  private adminService = new ReferralAdminService();
  private reportingService = new ReferralReportingService();

  // ── Partners ──────────────────────────────────────────────────────────

  createPartner = handleAsyncControl(async (req: Request, res: Response) => {
    const partner = await this.adminService.createPartner(
      req.user?._id as unknown as string,
      req.body,
    );
    audit(req, "partner.create", "Partner", partner._id.toString(), {
      name: partner.name,
      slug: partner.slug,
    });
    return ok(res, "Partner created successfully", { partner }, HttpStatus.CREATED);
  });

  listPartners = handleAsyncControl(async (_req: Request, res: Response) => {
    const partners = await this.adminService.listPartners();
    return ok(res, "Partners fetched successfully", { partners });
  });

  getPartner = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const partner = await this.adminService.getPartner(req.params.partnerId);
      return ok(res, "Partner fetched successfully", { partner });
    },
  );

  updatePartner = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const partner = await this.adminService.updatePartner(
        req.params.partnerId,
        req.body,
      );
      audit(req, "partner.update", "Partner", req.params.partnerId, req.body);
      return ok(res, "Partner updated successfully", { partner });
    },
  );

  // ── Credentials ───────────────────────────────────────────────────────

  issueCredential = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const result = await this.adminService.issueCredential(
        req.user?._id as unknown as string,
        req.params.partnerId,
        req.body,
      );
      // Never log the secret — only the public keyId and scopes.
      audit(req, "partner_credential.issue", "Partner", req.params.partnerId, {
        keyId: result.credential.keyId,
        scopes: result.credential.scopes,
      });
      res.setHeader("Cache-Control", "no-store");
      return ok(
        res,
        "Partner credential issued. Store the apiKey now — it cannot be retrieved again.",
        result,
        HttpStatus.CREATED,
      );
    },
  );

  listCredentials = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const credentials = await this.adminService.listCredentials(
        req.params.partnerId,
      );
      return ok(res, "Partner credentials fetched successfully", { credentials });
    },
  );

  revokeCredential = handleAsyncControl(
    async (req: Request<{ partnerId: string; keyId: string }>, res: Response) => {
      const credential = await this.adminService.revokeCredential(
        req.user?._id as unknown as string,
        req.params.partnerId,
        req.params.keyId,
      );
      audit(req, "partner_credential.revoke", "Partner", req.params.partnerId, {
        keyId: req.params.keyId,
      });
      return ok(res, "Partner credential revoked", { credential });
    },
  );

  // ── Campaigns ─────────────────────────────────────────────────────────

  createCampaign = handleAsyncControl(async (req: Request, res: Response) => {
    const campaign = await this.adminService.createCampaign(
      req.user?._id as unknown as string,
      req.body,
    );
    audit(req, "referral_campaign.create", "ReferralCampaign", campaign._id.toString(), {
      name: campaign.name,
      programType: campaign.programType,
    });
    return ok(res, "Campaign created successfully", { campaign }, HttpStatus.CREATED);
  });

  listCampaigns = handleAsyncControl(async (req: Request, res: Response) => {
    const filters = listCampaignsQuerySchema.parse(req.query);
    const campaigns = await this.adminService.listCampaigns(filters);
    return ok(res, "Campaigns fetched successfully", { campaigns });
  });

  getCampaign = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const campaign = await this.adminService.getCampaign(req.params.campaignId);
      return ok(res, "Campaign fetched successfully", { campaign });
    },
  );

  updateCampaign = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const campaign = await this.adminService.updateCampaign(
        req.params.campaignId,
        req.body,
      );
      audit(req, "referral_campaign.update", "ReferralCampaign", req.params.campaignId, req.body);
      return ok(res, "Campaign updated successfully", { campaign });
    },
  );

  // ── Codes ─────────────────────────────────────────────────────────────

  createCode = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const code = await this.adminService.createCode(
        req.user?._id as unknown as string,
        req.params.campaignId,
        req.body,
      );
      audit(req, "referral_code.create", "ReferralCode", code._id.toString(), {
        code: code.code,
        campaignId: req.params.campaignId,
        audience: code.audience,
      });
      return ok(res, "Referral code created successfully", { code }, HttpStatus.CREATED);
    },
  );

  listCodes = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const codes = await this.adminService.listCodes(req.params.campaignId);
      return ok(res, "Referral codes fetched successfully", { codes });
    },
  );

  updateCode = handleAsyncControl(
    async (req: Request<{ campaignId: string; codeId: string }>, res: Response) => {
      const code = await this.adminService.updateCode(
        req.params.campaignId,
        req.params.codeId,
        req.body,
      );
      audit(req, "referral_code.update", "ReferralCode", req.params.codeId, req.body);
      return ok(res, "Referral code updated successfully", { code });
    },
  );

  // ── Reporting ─────────────────────────────────────────────────────────

  getCampaignMetrics = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const query = campaignMetricsQuerySchema.parse(req.query);
      const metrics = await this.reportingService.getCampaignMetrics(
        req.params.campaignId,
        query,
      );
      return ok(res, "Campaign metrics fetched successfully", metrics);
    },
  );

  exportCampaignCsv = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const csv = await this.reportingService.exportCampaignCsv(
        req.params.campaignId,
      );
      audit(req, "referral_campaign.export", "ReferralCampaign", req.params.campaignId);
      const filename = `referral-attributions-${req.params.campaignId}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(HttpStatus.OK).send(csv);
    },
  );

  listAttributions = handleAsyncControl(async (req: Request, res: Response) => {
    const filters = listAttributionsQuerySchema.parse(req.query);
    const result = await this.adminService.listAttributions(filters);
    return ok(res, "Attributions fetched successfully", result);
  });
}
