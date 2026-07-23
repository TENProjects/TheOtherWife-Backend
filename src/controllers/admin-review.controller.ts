/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { AdminReviewService } from "../services/admin-review.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

type IdParam = { id: string };

export class AdminReviewController {
  private adminReviewService: AdminReviewService;

  constructor() {
    this.adminReviewService = new AdminReviewService();
  }

  getReviews = handleAsyncControl(async (req: Request, res: Response) => {
    const { page, limit, vendorId, moderationStatus, rating } = req.query;
    const result = await this.adminReviewService.getReviews({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      vendorId: vendorId as string | undefined,
      moderationStatus: moderationStatus as string | undefined,
      rating: rating ? Number(rating) : undefined,
    });

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Reviews fetched successfully",
      data: result,
    } as ApiResponse);
  });

  getReviewById = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const review = await this.adminReviewService.getReviewById(
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Review fetched successfully",
        data: { review },
      } as ApiResponse);
    },
  );

  updateStatus = handleAsyncControl(
    async (
      req: Request<IdParam, {}, { moderationStatus: "visible" | "hidden" }>,
      res: Response,
    ) => {
      const adminUserId = req.user?._id as unknown as string;
      const review = await this.adminReviewService.updateReviewStatus(
        req.params.id,
        req.body.moderationStatus,
      );

      logAdminAction({
        adminUserId,
        action:
          req.body.moderationStatus === "hidden" ? "review.hide" : "review.unhide",
        targetType: "MealReview",
        targetId: req.params.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Review updated successfully",
        data: { review },
      } as ApiResponse);
    },
  );

  deleteReview = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const adminUserId = req.user?._id as unknown as string;
      await this.adminReviewService.deleteReview(req.params.id);

      logAdminAction({
        adminUserId,
        action: "review.delete",
        targetType: "MealReview",
        targetId: req.params.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Review deleted successfully",
      } as ApiResponse);
    },
  );
}
