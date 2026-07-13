/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { AdminMealPlanService } from "../services/admin-meal-plan.service.js";
import { ApiResponse } from "../util/response.util.js";

export class AdminMealPlanController {
  private service: AdminMealPlanService;

  constructor() {
    this.service = new AdminMealPlanService();
  }

  listActivePlans = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { page, limit } = req.query;
      const result = await this.service.listActivePlans({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Active meal plans fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getScheduledMealMonitor = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.service.getScheduledMealMonitor();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Scheduled meal monitor fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
