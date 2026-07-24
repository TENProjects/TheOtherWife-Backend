/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { FinancialsService } from "../services/financials.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class FinancialsController {
  private financialsService: FinancialsService;

  constructor() {
    this.financialsService = new FinancialsService();
  }

  getSummary = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const summary = await this.financialsService.getSummary();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Financial summary fetched successfully",
        data: summary,
      } as ApiResponse);
    },
  );

  getAnalytics = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const analytics = await this.financialsService.getAnalytics();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Financial analytics fetched successfully",
        data: analytics,
      } as ApiResponse);
    },
  );

  getPaymentGateways = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const gateways = await this.financialsService.getPaymentGateways();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Payment gateways fetched successfully",
        data: { gateways },
      } as ApiResponse);
    },
  );

  updatePaymentGateway = handleAsyncControl(
    async (
      req: Request<
        { key: string },
        {},
        {
          isActive?: boolean;
          transactionFeePercent?: number;
          publicKey?: string;
          secretKey?: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const { key } = req.params;
      const adminUserId = req.user?._id as unknown as string;

      const gateway = await this.financialsService.updatePaymentGateway(
        key,
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "financials.gateway_update",
        targetType: "FinancialSettings",
        targetId: key,
        metadata: {
          isActive: req.body.isActive,
          transactionFeePercent: req.body.transactionFeePercent,
          publicKeyChanged: req.body.publicKey !== undefined,
          secretKeyChanged: req.body.secretKey !== undefined,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Payment gateway updated successfully",
        data: gateway,
      } as ApiResponse);
    },
  );

  testPaymentGatewayConnection = handleAsyncControl(
    async (
      req: Request<{ key: string }, {}, { secretKey: string }>,
      res: Response,
    ): Promise<Response> => {
      const { key } = req.params;
      const result = await this.financialsService.testGatewayConnection(
        key,
        req.body.secretKey,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: result.message,
        data: result,
      } as ApiResponse);
    },
  );

  getCommissionConfig = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const config = await this.financialsService.getCommissionConfig();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Commission configuration fetched successfully",
        data: config,
      } as ApiResponse);
    },
  );

  updateCommissionConfig = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { commissionType: "percentage" | "flat"; commissionRate: number }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;

      const config = await this.financialsService.updateCommissionConfig(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "financials.commission_update",
        targetType: "FinancialSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Commission configuration updated successfully",
        data: config,
      } as ApiResponse);
    },
  );

  getTaxSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const taxSettings = await this.financialsService.getTaxSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Tax settings fetched successfully",
        data: taxSettings,
      } as ApiResponse);
    },
  );

  updateTaxSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { defaultRate: number; categories?: { name: string; rate: number }[] }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;

      const taxSettings = await this.financialsService.updateTaxSettings(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "financials.tax_update",
        targetType: "FinancialSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Tax settings updated successfully",
        data: taxSettings,
      } as ApiResponse);
    },
  );

  getVatSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const vatSettings = await this.financialsService.getVatSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "VAT settings fetched successfully",
        data: vatSettings,
      } as ApiResponse);
    },
  );

  updateVatSettings = handleAsyncControl(
    async (
      req: Request<{}, {}, { enabled: boolean; confirm: true }>,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;

      const vatSettings = await this.financialsService.updateVatSettings(
        { enabled: req.body.enabled },
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "financials.vat_toggle",
        targetType: "FinancialSettings",
        metadata: { enabled: req.body.enabled },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "VAT settings updated successfully",
        data: vatSettings,
      } as ApiResponse);
    },
  );

  getOrderProfitBreakdown = handleAsyncControl(
    async (req: Request<{ orderId: string }>, res: Response): Promise<Response> => {
      const breakdown = await this.financialsService.getOrderProfitBreakdown(
        req.params.orderId,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Order profit breakdown fetched successfully",
        data: breakdown,
      } as ApiResponse);
    },
  );

  getNetProfitSummary = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;

      const summary = await this.financialsService.getNetProfitSummary({ from, to });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Net profit summary fetched successfully",
        data: summary,
      } as ApiResponse);
    },
  );

  getSystemSettings = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const settings = await this.financialsService.getSystemSettings();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "System settings fetched successfully",
        data: settings,
      } as ApiResponse);
    },
  );

  updateSystemSettings = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          refundAutoApprovalThreshold?: number;
          orderDelayThresholdMinutes?: number;
          minimumWithdrawalAmount?: number;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;

      const settings = await this.financialsService.updateSystemSettings(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "financials.system_settings_update",
        targetType: "FinancialSettings",
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "System settings updated successfully",
        data: settings,
      } as ApiResponse);
    },
  );
}
