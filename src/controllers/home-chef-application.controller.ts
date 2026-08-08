/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HomeChefApplicationService } from "../services/home-chef-application.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

type IdParam = { id: string };

export class HomeChefApplicationController {
  private homeChefApplicationService: HomeChefApplicationService;

  constructor() {
    this.homeChefApplicationService = new HomeChefApplicationService();
  }

  // ── Public ───────────────────────────────────────────────────────────

  create = handleAsyncControl(async (req: Request, res: Response) => {
    const application = await this.homeChefApplicationService.createApplication(
      req.body,
    );

    return res.status(HttpStatus.CREATED).json({
      status: "ok",
      message: "Application submitted successfully",
      data: { application },
    } as ApiResponse);
  });

  // ── Admin ────────────────────────────────────────────────────────────

  getAdminApplications = handleAsyncControl(
    async (req: Request, res: Response) => {
      const { page, limit, status, search } = req.query;
      const result = await this.homeChefApplicationService.getApplications({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: status as string | undefined,
        search: search as string | undefined,
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Applications fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getAdminApplicationById = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const application = await this.homeChefApplicationService.getApplicationById(
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Application fetched successfully",
        data: { application },
      } as ApiResponse);
    },
  );

  updateStatus = handleAsyncControl(
    async (
      req: Request<IdParam, {}, { status?: string; adminNotes?: string }>,
      res: Response,
    ) => {
      const adminUserId = req.user?._id as unknown as string;
      const application = await this.homeChefApplicationService.updateStatus(
        adminUserId,
        req.params.id,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "homechef_application.status_update",
        targetType: "HomeChefApplication",
        targetId: req.params.id,
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Application updated successfully",
        data: { application },
      } as ApiResponse);
    },
  );

  exportCsv = handleAsyncControl(async (req: Request, res: Response) => {
    const { status, search } = req.query;
    const csv = await this.homeChefApplicationService.exportToCsv({
      status: status as string | undefined,
      search: search as string | undefined,
    });

    const filename = `homechef-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return res.status(HttpStatus.OK).send(csv);
  });
}
