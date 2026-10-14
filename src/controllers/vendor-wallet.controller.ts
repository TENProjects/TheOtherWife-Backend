/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { VendorWalletService } from "../services/vendor-wallet.service.js";
import { logAdminAction } from "../util/audit-log.util.js";
import { payoutTransferService } from "../services/payout-transfer.service.js";

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
    const { page, limit } = req.query;
    const result = await this.vendorWalletService.getAdminPayoutRequests(status, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

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

  // What an automatic payout would do, and everything blocking it.
  getPayoutTransferPreview = handleAsyncControl(
    async (req: Request<{ requestId: string }>, res: Response) => {
      const preview = await payoutTransferService.preview(req.params.requestId);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Payout transfer preview fetched successfully",
        data: preview,
      });
    },
  );

  // Send an approved payout through Paystack. The admin must confirm the
  // bank's account name shown in the preview.
  sendPayoutTransfer = handleAsyncControl(
    async (req: Request<{ requestId: string }, {}, { confirmAccountName?: unknown }>, res: Response) => {
      const adminUserId = String(req.user?._id);
      const confirmAccountName =
        typeof req.body?.confirmAccountName === "string" ? req.body.confirmAccountName.slice(0, 200) : "";
      const result = await payoutTransferService.send(adminUserId, req.params.requestId, confirmAccountName);

      logAdminAction({
        adminUserId,
        action: "payout.transfer.send",
        targetType: "VendorPayoutRequest",
        targetId: req.params.requestId,
        metadata: { transferStatus: result.transfer?.status, amount: result.transfer?.amount },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message:
          result.transfer?.status === "success"
            ? "Payout sent and confirmed"
            : result.transfer?.status === "failed"
            ? "Paystack did not send the payout"
            : "Payout sent to Paystack — waiting for the bank",
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
