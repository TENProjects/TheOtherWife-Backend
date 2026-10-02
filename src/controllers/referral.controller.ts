/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { AttributionService } from "../services/attribution.service.js";

export class ReferralController {
  private attributionService = new AttributionService();

  checkCode = handleAsyncControl(
    async (req: Request<{ code: string }>, res: Response) => {
      const result = await this.attributionService.checkCode(req.params.code);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: result.valid ? "Referral code is valid" : "Referral code is not valid",
        data: result,
      } as ApiResponse);
    },
  );

  claim = handleAsyncControl(
    async (
      req: Request<{}, {}, { code?: string; inviteToken?: string }>,
      res: Response,
    ) => {
      const userId = req.user?._id as unknown as string;
      const result = await this.attributionService.claim(userId, {
        code: req.body.code,
        inviteToken: req.body.inviteToken,
      });
      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Referral applied successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getMine = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.attributionService.getMyAttribution(userId);
    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Referral attribution fetched successfully",
      data: result,
    } as ApiResponse);
  });
}
