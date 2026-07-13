/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { AdminVendorRelationsService } from "../services/admin-vendor-relations.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";
import {
  VendorIssueCategory,
  VendorIssuePriority,
} from "../models/vendorIssue.model.js";

const truncate = (value: string, maxLength = 60): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

export class AdminVendorRelationsController {
  private service: AdminVendorRelationsService;

  constructor() {
    this.service = new AdminVendorRelationsService();
  }

  // ---- Overview ----

  getOverviewStats = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.service.getOverviewStats();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor relations overview fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Paystack Split Payment subaccount health ----

  getPaystackSubaccountIssues = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.service.getPaystackSubaccountIssues();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendors with unresolved Paystack subaccount issues fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  retryPaystackSubaccount = handleAsyncControl(
    async (req: Request<{ vendorId: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.retryPaystackSubaccount(
        adminUserId,
        req.params.vendorId,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.paystack_subaccount_retry",
        targetType: "Vendor",
        targetId: req.params.vendorId,
        metadata: {
          description: `Retried Paystack subaccount creation for ${result.vendorName}`,
          succeeded: !!result.paystackSubaccountCode,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: result.paystackSubaccountCode
          ? "Paystack subaccount created successfully"
          : "Paystack subaccount creation still failing — see error field",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Vendor onboarding ----

  getVendorApplications = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { status, search, page, limit } = req.query;
      const result = await this.service.getVendorApplications({
        status: status as string | undefined,
        search: search as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor applications fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getVendorApplicationDetail = handleAsyncControl(
    async (req: Request<{ vendorId: string }>, res: Response): Promise<Response> => {
      const result = await this.service.getVendorApplicationDetail(
        req.params.vendorId,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor application fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  approveVendorApplication = handleAsyncControl(
    async (req: Request<{ vendorId: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.approveVendorApplication(
        req.params.vendorId,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.application_approve",
        targetType: "Vendor",
        targetId: req.params.vendorId,
        metadata: {
          description: `Approved application from ${result.vendorName}`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor application approved successfully",
        data: result,
      } as ApiResponse);
    },
  );

  rejectVendorApplication = handleAsyncControl(
    async (
      req: Request<{ vendorId: string }, {}, { reason?: string }>,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.rejectVendorApplication(
        req.params.vendorId,
        adminUserId,
        req.body.reason,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.application_reject",
        targetType: "Vendor",
        targetId: req.params.vendorId,
        metadata: {
          description: `Rejected application from ${result.vendorName}`,
          reason: req.body.reason,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor application rejected successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Performance monitoring ----

  getVendorPerformance = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { status, search, page, limit } = req.query;
      const result = await this.service.getVendorPerformance({
        status: status as "active" | "warning" | undefined,
        search: search as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor performance fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getVendorPerformanceDetail = handleAsyncControl(
    async (req: Request<{ vendorId: string }>, res: Response): Promise<Response> => {
      const result = await this.service.getVendorPerformanceDetail(
        req.params.vendorId,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor performance detail fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  sendWarning = handleAsyncControl(
    async (
      req: Request<{ vendorId: string }, {}, { message: string }>,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.sendWarning(
        req.params.vendorId,
        adminUserId,
        req.body.message,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.warning_send",
        targetType: "Vendor",
        targetId: req.params.vendorId,
        metadata: {
          description: `Sent warning to ${result.vendorName}: "${truncate(req.body.message)}"`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Warning sent to vendor successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Issue resolution ----

  getIssues = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { status, priority, page, limit } = req.query;
      const result = await this.service.getIssues({
        status: status as string | undefined,
        priority: priority as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor issues fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getIssueDetail = handleAsyncControl(
    async (req: Request<{ issueId: string }>, res: Response): Promise<Response> => {
      const result = await this.service.getIssueDetail(req.params.issueId);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor issue fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  createIssue = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          vendorId: string;
          category: VendorIssueCategory;
          title: string;
          description: string;
          priority?: VendorIssuePriority;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.createIssue(adminUserId, req.body);

      logAdminAction({
        adminUserId,
        action: "vendor_relations.issue_create",
        targetType: "VendorIssue",
        targetId: result.issue._id,
        metadata: {
          description: `Logged issue for ${result.issue.vendorName}: ${result.issue.title}`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Vendor issue logged successfully",
        data: result,
      } as ApiResponse);
    },
  );

  resolveIssue = handleAsyncControl(
    async (
      req: Request<{ issueId: string }, {}, { resolutionNotes: string }>,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.resolveIssue(
        req.params.issueId,
        adminUserId,
        req.body.resolutionNotes,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.issue_resolve",
        targetType: "VendorIssue",
        targetId: req.params.issueId,
        metadata: {
          description: `Resolved issue for ${result.issue.vendorName}: ${result.issue.title}`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor issue resolved successfully",
        data: result,
      } as ApiResponse);
    },
  );

  escalateIssue = handleAsyncControl(
    async (req: Request<{ issueId: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.escalateIssue(req.params.issueId);

      logAdminAction({
        adminUserId,
        action: "vendor_relations.issue_escalate",
        targetType: "VendorIssue",
        targetId: req.params.issueId,
        metadata: {
          description: `Escalated issue for ${result.issue.vendorName}: ${result.issue.title}`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor issue escalated successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Communications ----

  getCommunicationsSummary = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.service.getCommunicationsSummary();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor communications summary fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getVendorMessages = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { limit } = req.query;
      const result = await this.service.getVendorMessages(
        limit ? Number(limit) : undefined,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor messages fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  sendMessageToVendor = handleAsyncControl(
    async (
      req: Request<{}, {}, { vendorId: string; message: string }>,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.sendMessageToVendor(
        adminUserId,
        req.body.vendorId,
        req.body.message,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.message_send",
        targetType: "Vendor",
        targetId: req.body.vendorId,
        metadata: {
          description: `Sent message to ${result.vendorName}`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Message sent to vendor successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getCallLogs = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { limit } = req.query;
      const result = await this.service.getCallLogs(
        limit ? Number(limit) : undefined,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor call logs fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  logCall = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { vendorId: string; durationSeconds: number; notes?: string }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.service.logCall(
        adminUserId,
        req.body.vendorId,
        req.body.durationSeconds,
        req.body.notes,
      );

      logAdminAction({
        adminUserId,
        action: "vendor_relations.call_log",
        targetType: "Vendor",
        targetId: req.body.vendorId,
        metadata: {
          description: `Logged a call with ${result.vendorName} (${req.body.durationSeconds}s)`,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Call logged successfully",
        data: result,
      } as ApiResponse);
    },
  );

  // ---- Recent activity ----

  getRecentActivity = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { limit } = req.query;
      const result = await this.service.getRecentActivity(
        limit ? Number(limit) : undefined,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Recent vendor relations activity fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
