/** @format */

import type { Request, Response, NextFunction } from "express";
import Vendor from "../models/vendor.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

export const statusCheck =
  (status: Array<string>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req?.user?._id;
      const vendor = await Vendor.findOne({ userId });
      const approvalStatus = vendor?.approvalStatus as string | undefined;

      if (!approvalStatus || !status.includes(approvalStatus)) {
        const statusMessageMap: Record<string, string> = {
          pending: "Awaiting approval: profile cannot perform this action",
          suspended: "Profile suspended: profile cannot perform this action",
          rejected: "Profile rejected: profile cannot perform this action",
        };

        throw new BadRequestException(
          statusMessageMap[approvalStatus ?? ""] ??
            "Profile status does not allow this action",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
