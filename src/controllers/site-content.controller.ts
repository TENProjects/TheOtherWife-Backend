/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { SiteContentService } from "../services/site-content.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class SiteContentController {
  private siteContentService: SiteContentService;

  constructor() {
    this.siteContentService = new SiteContentService();
  }

  getContent = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const content = await this.siteContentService.getContent();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Site content fetched successfully",
        data: content,
      } as ApiResponse);
    },
  );

  updateContent = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { aboutUs?: string; contactEmail?: string; contactPhone?: string }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const content = await this.siteContentService.updateContent(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "cms.update",
        targetType: "SiteContent",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Site content updated successfully",
        data: content,
      } as ApiResponse);
    },
  );
}
