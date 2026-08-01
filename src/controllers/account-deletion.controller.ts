/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { AccountDeletionService } from "../services/account-deletion.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";

export class AccountDeletionController {
  private accountDeletionService: AccountDeletionService;

  constructor() {
    this.accountDeletionService = new AccountDeletionService();
  }

  handleRequest = handleAsyncControl(
    async (
      req: Request<{}, {}, { email: string; deletionType: "full" | "erase_activity" }>,
      res: Response,
    ): Promise<Response> => {
      await this.accountDeletionService.requestDeletion(
        req.body.email,
        req.body.deletionType,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "If an account with this email exists, a verification code has been sent",
      } as ApiResponse);
    },
  );

  handleVerify = handleAsyncControl(
    async (
      req: Request<{}, {}, { email: string; code: string }>,
      res: Response,
    ): Promise<Response> => {
      const result = await this.accountDeletionService.verifyOtp(
        req.body.email,
        req.body.code,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Code verified",
        data: result,
      } as ApiResponse);
    },
  );

  handleConfirm = handleAsyncControl(
    async (
      req: Request<{}, {}, { deletionToken: string; reason?: string }>,
      res: Response,
    ): Promise<Response> => {
      const result = await this.accountDeletionService.confirmDeletion(
        req.body.deletionToken,
        req.body.reason,
      );

      if (result.status === "ineligible") {
        return res.status(HttpStatus.CONFLICT).json({
          status: "error",
          message: result.eligibility.hasOpenOrders
            ? "You have one or more orders in progress. Let them finish before deleting your account."
            : "You have a wallet balance. Spend it before deleting your account — it can't be recovered afterward.",
          data: { eligibility: result.eligibility },
        } as ApiResponse);
      }

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Request received",
        data: { reference: result.reference },
      } as ApiResponse);
    },
  );

  // Admin-facing (Super Admin > Account Deletions tab) — see routes/admin-account-deletion.route.ts.

  handleListPending = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await this.accountDeletionService.listPendingDeletions(page, limit);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Pending account deletions fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  handleAdminCancel = handleAsyncControl(
    async (
      req: Request<{ userId: string }>,
      res: Response,
    ): Promise<Response> => {
      await this.accountDeletionService.adminCancelPendingDeletion(req.params.userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Deletion request cancelled — account reactivated",
      } as ApiResponse);
    },
  );
}
