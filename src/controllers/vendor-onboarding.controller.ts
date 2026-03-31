/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { VendorOnboardingService } from "../services/vendor-onboarding.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { nodeEnv } from "../constants/env.js";

export class VendorOnboardingController {
  private vendorOnboardingService: VendorOnboardingService;

  constructor() {
    this.vendorOnboardingService = new VendorOnboardingService();
  }

  step1 = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          firstName: string;
          lastName: string;
          email: string;
          phoneNumber: string;
          password: string;
          confirmPassword: string;
          state: string;
          city: string;
          address?: string;
          socials?: {
            instagram?: string;
            facebook?: string;
            twitter?: string;
          };
        }
      >,
      res: Response,
    ) => {
      const result = await this.vendorOnboardingService.createStep1(req.body);

      return res
        .cookie("token", result.accessToken, {
          httpOnly: true,
          sameSite: "strict",
          secure: nodeEnv === "production",
        })
        .status(HttpStatus.CREATED)
        .json({
          status: "ok",
          message: "Vendor onboarding step 1 completed",
          data: result,
        } as ApiResponse);
    },
  );

  step2 = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorOnboardingService.saveStep2(userId, req.body);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor onboarding step 2 completed",
      data: result,
    } as ApiResponse);
  });

  step3 = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorOnboardingService.saveStep3(userId, req.body);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor onboarding step 3 completed",
      data: result,
    } as ApiResponse);
  });

  submit = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result = await this.vendorOnboardingService.submit(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor onboarding submitted successfully",
      data: result,
    } as ApiResponse);
  });

  getCurrent = handleAsyncControl(async (req: Request, res: Response) => {
    const userId = req.user?._id as unknown as string;
    const result =
      await this.vendorOnboardingService.getCurrentVendorOnboarding(userId);

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Vendor onboarding fetched successfully",
      data: result,
    } as ApiResponse);
  });

  getUploadSignature = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          documentType: "governmentId" | "businessCertificate" | "displayImage";
        }
      >,
      res: Response,
    ) => {
      const userId = req.user?._id as unknown as string;
      const result = await this.vendorOnboardingService.createUploadSignature(
        userId,
        req.body.documentType,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Cloudinary upload signature generated successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
