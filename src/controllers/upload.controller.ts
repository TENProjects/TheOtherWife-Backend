/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { UploadService } from "../services/upload.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";

export class UploadController {
  private uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

  getCloudinaryUploadSignature = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          assetType:
            | "vendorDocument"
            | "vendorBusinessLogo"
            | "mealImage"
            | "customerProfileImage";
        }
      >,
      res: Response,
    ) => {
      const userId = req.user?._id as unknown as string;
      const userType = req.user?.userType as string;

      const data = this.uploadService.createCloudinaryUploadSignature(
        userId,
        userType,
        req.body.assetType,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Cloudinary upload signature generated successfully",
        data,
      } as ApiResponse);
    },
  );
}
