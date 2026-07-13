/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { PromoCodeService } from "../services/promo-code.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";
import type { PromoCodeDiscountType } from "../models/promoCode.model.js";

export class PromoCodeController {
  private promoCodeService: PromoCodeService;

  constructor() {
    this.promoCodeService = new PromoCodeService();
  }

  createPromoCode = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          code: string;
          discountType: PromoCodeDiscountType;
          discountValue: number;
          expiresAt?: Date;
          maxUses?: number;
          minOrderValue?: number;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const promoCode = await this.promoCodeService.createPromoCode(
        req.body,
        adminUserId,
      );

      logAdminAction({
        adminUserId,
        action: "promo_code.create",
        targetType: "PromoCode",
        targetId: promoCode._id.toString(),
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Promo code created successfully",
        data: promoCode,
      } as ApiResponse);
    },
  );

  getAdminPromoCodes = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const promoCodes = await this.promoCodeService.getAdminPromoCodes();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Promo codes fetched successfully",
        data: promoCodes,
      } as ApiResponse);
    },
  );

  getAdminPromoCodeById = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const promoCode = await this.promoCodeService.getAdminPromoCodeById(
        req.params.id,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Promo code fetched successfully",
        data: promoCode,
      } as ApiResponse);
    },
  );

  updatePromoCode = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          isActive?: boolean;
          discountValue?: number;
          expiresAt?: Date;
          maxUses?: number;
          minOrderValue?: number;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const promoCode = await this.promoCodeService.updatePromoCode(
        req.params.id,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "promo_code.update",
        targetType: "PromoCode",
        targetId: req.params.id,
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Promo code updated successfully",
        data: promoCode,
      } as ApiResponse);
    },
  );
}
