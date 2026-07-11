/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { AdminAuditLogService } from "../services/admin-audit-log.service.js";
import { ApiResponse } from "../util/response.util.js";

export class AdminAuditLogController {
  private adminAuditLogService: AdminAuditLogService;

  constructor() {
    this.adminAuditLogService = new AdminAuditLogService();
  }

  getAuditLogs = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const result = await this.adminAuditLogService.getAuditLogs({
        action: req.query.action as string | undefined,
        targetType: req.query.targetType as string | undefined,
        adminUserId: req.query.adminUserId as string | undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Audit logs fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
