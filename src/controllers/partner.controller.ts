/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import {
  PartnerIntegrationService,
  PartnerSubmissionInput,
  SubmissionType,
} from "../services/partner-integration.service.js";
import {
  externalRefSchema,
  partnerListQuerySchema,
} from "../zod-schema/partner.schema.js";

// Partner API controller. req.partner is guaranteed by partnerAuthMiddleware;
// req.user is never consulted here.
export class PartnerController {
  private service = new PartnerIntegrationService();

  getProfile = handleAsyncControl(async (req: Request, res: Response) => {
    const result = await this.service.getProfile(req.partner!);
    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Partner profile fetched successfully",
      data: result,
    } as ApiResponse);
  });

  submit = (type: SubmissionType) =>
    handleAsyncControl(
      async (req: Request<{}, {}, PartnerSubmissionInput>, res: Response) => {
        const { httpStatus, data } = await this.service.submit(
          req.partner!,
          type,
          req.body,
        );
        return res.status(httpStatus).json({
          status: "ok",
          message:
            httpStatus === HttpStatus.CREATED
              ? "Submission accepted"
              : "Submission already exists",
          data,
        } as ApiResponse);
      },
    );

  getOne = (type: SubmissionType) =>
    handleAsyncControl(
      async (req: Request<{ externalRef: string }>, res: Response) => {
        const externalRef = externalRefSchema.parse(req.params.externalRef);
        const data = await this.service.getByExternalRef(
          req.partner!,
          type,
          externalRef,
        );
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Submission fetched successfully",
          data,
        } as ApiResponse);
      },
    );

  list = (type: SubmissionType) =>
    handleAsyncControl(async (req: Request, res: Response) => {
      const query = partnerListQuerySchema.parse(req.query);
      const data = await this.service.list(req.partner!, type, query);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Submissions fetched successfully",
        data,
      } as ApiResponse);
    });

  reissueInvite = (type: SubmissionType) =>
    handleAsyncControl(
      async (req: Request<{ externalRef: string }>, res: Response) => {
        const externalRef = externalRefSchema.parse(req.params.externalRef);
        const data = await this.service.reissueInvite(
          req.partner!,
          type,
          externalRef,
        );
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Invite re-issued. Previous claim token is no longer valid.",
          data,
        } as ApiResponse);
      },
    );
}
