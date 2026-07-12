/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { VendorWalletService } from "../services/vendor-wallet.service.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class VendorWalletController {
  private vendorWalletService: VendorWalletService;

  constructor() {
    this.vendorWalletService = new VendorWalletService();
  }

  getSummary = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorWalletService.getVendorWalletSummary(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor wallet summary fetched successfully",
      data: result,
    });
  });

  getTransactions = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const settlementStatus = req.query.settlementStatus as string | undefined;

    const result = await this.vendorWalletService.getVendorTransactions(userId, {
      page,
      limit,
      settlementStatus,
    });

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor wallet transactions fetched successfully",
      data: result,
    });
  });

  requestPayout = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          amount: number;
          note?: string;
          bankName?: string;
          accountName?: string;
          accountNumber?: string;
        }
      >,
      res: Response,
    ) => {
      const userId = req.user?._id as unknown as string;
      const result = await this.vendorWalletService.requestVendorPayout(userId, req.body);

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Vendor payout request created successfully",
        data: result,
      });
    },
  );

  getPayoutRequests = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorWalletService.getVendorPayoutRequests(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor payout requests fetched successfully",
      data: result,
    });
  });

  getPayoutSettings = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorWalletService.getVendorPayoutSettings(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor payout settings fetched successfully",
      data: result,
    });
  });

  updatePayoutSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          autoPayoutEnabled?: boolean;
          schedule?: "daily" | "weekly" | "biweekly" | "monthly";
          minimumAmount?: number;
          defaultMethod?: "bank" | "card";
          bankDetails?: {
            bankName?: string;
            accountName?: string;
            accountNumber?: string;
          };
        }
      >,
      res: Response,
    ) => {
      const userId = req.user?._id as unknown as string;
      const result = await this.vendorWalletService.updateVendorPayoutSettings(
        userId,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor payout settings updated successfully",
        data: result,
      });
    },
  );

  getAdminPayoutRequests = handleAsyncControl(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const result = await this.vendorWalletService.getAdminPayoutRequests(status);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor payout requests fetched successfully",
      data: result,
    });
  });

  getAdminPayoutRequestById = handleAsyncControl(
    async (req: Request<{ requestId: string }>, res: Response) => {
      const result = await this.vendorWalletService.getAdminPayoutRequestById(
        req.params.requestId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor payout request fetched successfully",
        data: result,
      });
    },
  );

  updateAdminPayoutRequest = handleAsyncControl(
    async (
      req: Request<
        { requestId: string },
        {},
        {
          status?: "requested" | "processing" | "approved" | "rejected";
          action?: "approve" | "reject" | "process";
          paymentStatus?: "unpaid" | "paid";
          approvedAmount?: number;
          payoutReference?: string;
          note?: string;
          rejectionReason?: string;
          allocations?: { paymentId: string; amount: number }[];
        }
      >,
      res: Response,
    ) => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.vendorWalletService.updateAdminPayoutRequest(
        adminUserId,
        req.params.requestId,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "payout.update",
        targetType: "VendorPayoutRequest",
        targetId: req.params.requestId,
        metadata: { ...req.body, allocations: undefined },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor payout request updated successfully",
        data: result,
      });
    },
  );
}
