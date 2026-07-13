/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { RefundService } from "../services/refund.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class RefundController {
  private refundService: RefundService;

  constructor() {
    this.refundService = new RefundService();
  }

  createRefundRequest = handleAsyncControl(
    async (
      req: Request<{ id: string }, {}, { amount?: number; reason: string }>,
      res: Response,
    ): Promise<Response> => {
      const requesterId = req.user?._id as unknown as string;
      const requesterType = req.user?.userType as unknown as string;

      const result = await this.refundService.createRefundRequest(
        requesterId,
        requesterType,
        req.params.id,
        req.body,
      );

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Refund request submitted successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getAdminRefundRequests = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const status = req.query.status as string | undefined;
      const result = await this.refundService.getAdminRefundRequests(status);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Refund requests fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getAdminRefundRequestById = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const result = await this.refundService.getAdminRefundRequestById(
        req.params.id,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Refund request fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  decideRefundRequest = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          decision: "approve" | "reject";
          approvedAmount?: number;
          adminNotes?: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const { decision, approvedAmount, adminNotes } = req.body;

      const result = await this.refundService.decideRefundRequest(
        adminUserId,
        req.params.id,
        decision,
        approvedAmount,
        adminNotes,
      );

      logAdminAction({
        adminUserId,
        action: decision === "approve" ? "refund.approve" : "refund.reject",
        targetType: "RefundRequest",
        targetId: req.params.id,
        metadata: { adminNotes },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: `Refund request ${decision === "approve" ? "approved" : "rejected"} successfully`,
        data: result,
      } as ApiResponse);
    },
  );
}
