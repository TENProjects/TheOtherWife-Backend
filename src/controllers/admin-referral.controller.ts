/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";
import { ReferralAdminService } from "../services/referral-admin.service.js";
import { ReferralReportingService } from "../services/referral-reporting.service.js";
import { PartnerWebhookService } from "../services/partner-webhook.service.js";
import { PartnerSettlementService } from "../services/partner-settlement.service.js";
import {
  campaignMetricsQuerySchema,
  listAttributionsQuerySchema,
  listCampaignsQuerySchema,
  listCodesQuerySchema,
  listCredentialsQuerySchema,
  listPartnersQuerySchema,
  listSettlementsQuerySchema,
  paginationQuerySchema,
  listWebhookDeliveriesQuerySchema,
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
  private webhookService = new PartnerWebhookService();
  private settlementService = new PartnerSettlementService();

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

  listPartners = handleAsyncControl(async (req: Request, res: Response) => {
    const filters = listPartnersQuerySchema.parse(req.query);
    const result = await this.adminService.listPartners(filters);
    return ok(res, "Partners fetched successfully", result);
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
      const filters = listCredentialsQuerySchema.parse(req.query);
      const result = await this.adminService.listCredentials(req.params.partnerId, filters);
      return ok(res, "Partner credentials fetched successfully", result);
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

  updateCredential = handleAsyncControl(
    async (req: Request<{ partnerId: string; keyId: string }>, res: Response) => {
      const result = await this.adminService.updateCredential(
        req.params.partnerId,
        req.params.keyId,
        req.body,
      );
      audit(req, "partner_credential.update", "Partner", req.params.partnerId, {
        keyId: req.params.keyId,
        ...req.body,
      });
      return ok(res, "Partner credential updated", result);
    },
  );

  rotateSigningSecret = handleAsyncControl(
    async (req: Request<{ partnerId: string; keyId: string }>, res: Response) => {
      const result = await this.adminService.rotateSigningSecret(
        req.params.partnerId,
        req.params.keyId,
      );
      audit(req, "partner_credential.signing_secret_rotate", "Partner", req.params.partnerId, {
        keyId: req.params.keyId,
      });
      res.setHeader("Cache-Control", "no-store");
      return ok(
        res,
        "Signing secret issued. Store it now — it cannot be retrieved again. The previous signing secret no longer works.",
        result,
      );
    },
  );

  // ── Webhooks ──────────────────────────────────────────────────────────

  getWebhook = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const result = await this.webhookService.getWebhook(req.params.partnerId);
      return ok(res, "Partner webhook fetched", result);
    },
  );

  configureWebhook = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const result = await this.webhookService.configureWebhook(
        req.params.partnerId,
        req.body,
      );
      audit(req, "partner_webhook.configure", "Partner", req.params.partnerId, {
        url: req.body.url,
        enabled: req.body.enabled,
        secretIssued: "signingSecret" in result,
      });
      res.setHeader("Cache-Control", "no-store");
      return ok(
        res,
        "signingSecret" in result
          ? "Webhook configured. Store the signingSecret now — it cannot be retrieved again."
          : "Webhook updated",
        result,
      );
    },
  );

  rotateWebhookSecret = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const result = await this.webhookService.rotateWebhookSecret(req.params.partnerId);
      audit(req, "partner_webhook.secret_rotate", "Partner", req.params.partnerId);
      res.setHeader("Cache-Control", "no-store");
      return ok(
        res,
        "Webhook signing secret rotated. Store it now — it cannot be retrieved again.",
        result,
      );
    },
  );

  testWebhook = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const result = await this.webhookService.sendTestPing(req.params.partnerId);
      audit(req, "partner_webhook.test", "Partner", req.params.partnerId, {
        eventId: result.eventId,
        delivered: result.delivered,
      });
      return ok(res, result.delivered ? "Test event delivered" : "Test event was not delivered", result);
    },
  );

  listWebhookDeliveries = handleAsyncControl(
    async (req: Request<{ partnerId: string }>, res: Response) => {
      const filters = listWebhookDeliveriesQuerySchema.parse(req.query);
      const result = await this.webhookService.listDeliveries(req.params.partnerId, filters);
      return ok(res, "Webhook deliveries fetched", result);
    },
  );

  retryWebhookDelivery = handleAsyncControl(
    async (req: Request<{ partnerId: string; eventId: string }>, res: Response) => {
      const result = await this.webhookService.retryDelivery(
        req.params.partnerId,
        req.params.eventId,
      );
      audit(req, "partner_webhook.delivery_retry", "Partner", req.params.partnerId, {
        eventId: req.params.eventId,
      });
      return ok(res, "Delivery re-queued", result);
    },
  );

  // ── Settlements ───────────────────────────────────────────────────────

  listPlatformCosts = handleAsyncControl(async (req: Request, res: Response) => {
    const result = await this.settlementService.listPlatformCosts(paginationQuerySchema.parse(req.query));
    return ok(res, "Platform costs fetched", result);
  });

  upsertPlatformCost = handleAsyncControl(
    async (req: Request<{ month: string }>, res: Response) => {
      const result = await this.settlementService.upsertPlatformCost(
        req.user?._id as unknown as string,
        req.params.month,
        req.body,
      );
      audit(req, "platform_cost.upsert", "PlatformCost", req.params.month, req.body);
      return ok(res, "Platform cost saved", result);
    },
  );

  listCustomerWeeks = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const result = await this.settlementService.listCustomerWeeks(
        req.params.campaignId,
        paginationQuerySchema.parse(req.query),
      );
      return ok(res, "Customer statement weeks fetched", result);
    },
  );

  getCustomerWeek = handleAsyncControl(
    async (req: Request<{ campaignId: string; weekStart: string }>, res: Response) => {
      const result = await this.settlementService.getCustomerWeek(
        req.params.campaignId,
        req.params.weekStart,
        paginationQuerySchema.parse(req.query),
      );
      return ok(res, "Customer statement fetched", result);
    },
  );

  finalizeCustomerWeek = handleAsyncControl(
    async (req: Request<{ campaignId: string; weekStart: string }>, res: Response) => {
      const result = await this.settlementService.finalizeCustomerWeek(
        req.user?._id as unknown as string,
        req.params.campaignId,
        req.params.weekStart,
      );
      audit(req, "partner_settlement.finalize_customer_week", "ReferralCampaign", req.params.campaignId, {
        settlementId: result.settlement.settlementId,
        weekStart: req.params.weekStart,
        payout: result.settlement.totals?.payout,
      });
      return ok(res, "Customer statement finalized", result, HttpStatus.CREATED);
    },
  );

  listHomechefBatches = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const result = await this.settlementService.listHomechefBatches(req.params.campaignId);
      return ok(res, "HomeChef batches fetched", result);
    },
  );

  getHomechefBatch = handleAsyncControl(
    async (req: Request<{ campaignId: string; batchNumber: string }>, res: Response) => {
      const result = await this.settlementService.getHomechefBatch(
        req.params.campaignId,
        Number(req.params.batchNumber),
        paginationQuerySchema.parse(req.query),
      );
      return ok(res, "HomeChef batch fetched", result);
    },
  );

  finalizeHomechefBatch = handleAsyncControl(
    async (req: Request<{ campaignId: string; batchNumber: string }>, res: Response) => {
      const result = await this.settlementService.finalizeHomechefBatch(
        req.user?._id as unknown as string,
        req.params.campaignId,
        Number(req.params.batchNumber),
      );
      audit(req, "partner_settlement.finalize_homechef_batch", "ReferralCampaign", req.params.campaignId, {
        settlementId: result.settlement.settlementId,
        batchNumber: Number(req.params.batchNumber),
        payout: result.settlement.totals?.payout,
      });
      return ok(res, "HomeChef batch finalized", result, HttpStatus.CREATED);
    },
  );

  listSettlements = handleAsyncControl(
    async (req: Request<{ campaignId: string }>, res: Response) => {
      const result = await this.settlementService.listSettlements(
        req.params.campaignId,
        listSettlementsQuerySchema.parse(req.query),
      );
      return ok(res, "Settlements fetched", result);
    },
  );

  getSettlement = handleAsyncControl(
    async (req: Request<{ settlementId: string }>, res: Response) => {
      const result = await this.settlementService.getSettlement(
        req.params.settlementId,
        paginationQuerySchema.parse(req.query),
      );
      return ok(res, "Settlement fetched", result);
    },
  );

  markSettlementPaid = handleAsyncControl(
    async (req: Request<{ settlementId: string }>, res: Response) => {
      const result = await this.settlementService.markPaid(
        req.user?._id as unknown as string,
        req.params.settlementId,
        req.body,
      );
      audit(req, "partner_settlement.mark_paid", "PartnerSettlement", req.params.settlementId, {
        paymentReference: req.body.paymentReference,
        payout: result.settlement.totals?.payout,
      });
      return ok(res, "Settlement marked as paid", result);
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
    const result = await this.adminService.listCampaigns(filters);
    return ok(res, "Campaigns fetched successfully", result);
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
      const filters = listCodesQuerySchema.parse(req.query);
      const result = await this.adminService.listCodes(req.params.campaignId, filters);
      return ok(res, "Referral codes fetched successfully", result);
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
