/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { PartnershipDashboardService } from "../services/partnership-dashboard.service.js";
import {
  listPartnershipsQuerySchema,
  paginationQuerySchema,
  partnershipCustomersQuerySchema,
  partnershipEarningsActivityQuerySchema,
  partnershipHomechefsQuerySchema,
} from "../zod-schema/referral.schema.js";

const ok = (res: Response, message: string, data: unknown) =>
  res.status(HttpStatus.OK).json({ status: "ok", message, data } as ApiResponse);

type CampaignParams = { campaignId: string };

// Read-only endpoints shaped for the admin "Partnerships" screens.
export class AdminPartnershipController {
  private service = new PartnershipDashboardService();

  listPartnerships = handleAsyncControl(async (req: Request, res: Response) => {
    const result = await this.service.listPartnerships(listPartnershipsQuerySchema.parse(req.query));
    return ok(res, "Partnerships fetched", result);
  });

  getOverview = handleAsyncControl(async (req: Request<CampaignParams>, res: Response) => {
    const result = await this.service.getOverview(
      req.params.campaignId,
      paginationQuerySchema.parse(req.query),
    );
    return ok(res, "Partnership overview fetched", result);
  });

  listHomechefs = handleAsyncControl(async (req: Request<CampaignParams>, res: Response) => {
    const result = await this.service.listHomechefs(
      req.params.campaignId,
      partnershipHomechefsQuerySchema.parse(req.query),
    );
    return ok(res, "Partnership HomeChefs fetched", result);
  });

  getHomechef = handleAsyncControl(
    async (req: Request<CampaignParams & { attributionId: string }>, res: Response) => {
      const result = await this.service.getHomechef(req.params.campaignId, req.params.attributionId);
      return ok(res, "HomeChef details fetched", result);
    },
  );

  listCustomers = handleAsyncControl(async (req: Request<CampaignParams>, res: Response) => {
    const result = await this.service.listCustomers(
      req.params.campaignId,
      partnershipCustomersQuerySchema.parse(req.query),
    );
    return ok(res, "Partnership customers fetched", result);
  });

  getCustomer = handleAsyncControl(
    async (req: Request<CampaignParams & { attributionId: string }>, res: Response) => {
      const result = await this.service.getCustomer(
        req.params.campaignId,
        req.params.attributionId,
        paginationQuerySchema.parse(req.query),
      );
      return ok(res, "Customer details fetched", result);
    },
  );

  getEarnings = handleAsyncControl(async (req: Request<CampaignParams>, res: Response) => {
    const result = await this.service.getEarnings(req.params.campaignId);
    return ok(res, "Partnership earnings fetched", result);
  });

  listEarningsActivity = handleAsyncControl(
    async (req: Request<CampaignParams>, res: Response) => {
      const result = await this.service.listEarningsActivity(
        req.params.campaignId,
        partnershipEarningsActivityQuerySchema.parse(req.query),
      );
      return ok(res, "Earnings activity fetched", result);
    },
  );
}
