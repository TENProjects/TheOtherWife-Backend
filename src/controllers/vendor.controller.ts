/** @format */

import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { VendorService } from "../services/vendor.service.js";
import type { Request, Response } from "express";
import { ApiResponse } from "../util/response.util.js";

export class VendorController {
  vendorService: VendorService;
  constructor() {
    this.vendorService = new VendorService();
  }

  getVendorProfile = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      try {
        const vendor = await this.vendorService.getVendorProfile(userId);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Vendor profile retrieved successfully",
          data: vendor,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  getFeaturedVendors = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const limitValue = Number(req.query.limit);
      const featuredVendors = await this.vendorService.getFeaturedVendors(
        req.user?.userType === "customer"
          ? (req.user?._id as unknown as string)
          : undefined,
        Number.isFinite(limitValue) ? limitValue : undefined,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Featured vendors fetched successfully",
        data: featuredVendors,
      } as ApiResponse);
    },
  );

  getVendorReviews = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      const reviews = await this.vendorService.getVendorReviews(userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor reviews fetched successfully",
        data: reviews,
      } as ApiResponse);
    },
  );

  updateVendorProfile = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          firstName: string;
          lastName: string;
          phoneNumber: string;
          businessName: string;
          businessDescription: string;
          businessLogoUrl: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const vendorId = req.params.id;
      const userId = req?.user?._id as unknown as string;

      const {
        firstName,
        lastName,
        phoneNumber,
        businessName,
        businessDescription,
        businessLogoUrl,
      } = req.body;

      try {
        const vendor = await this.vendorService.updateVendorProfile(userId, {
          firstName,
          lastName,
          phoneNumber,
          businessName,
          businessDescription,
          businessLogoUrl,
        });
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Vendor profile updated successfully",
          data: vendor,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  approveVendor = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const vendorId = req.params.id;
      const userId = req.user?._id as unknown as string;
      const userType = req.user?.userType as unknown as string;

      try {
        const vendor = await this.vendorService.approveVendor(
          vendorId,
          userId,
          userType,
        );
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Vendor approved successfully",
          data: vendor,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  rejectVendor = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          rejectionReason: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const vendorId = req.params.id;
      const userId = req?.user?._id as unknown as string;
      const rejectionReason = req.body.rejectionReason;

      try {
        const vendor = await this.vendorService.rejectVendor(
          vendorId,
          userId,
          rejectionReason,
        );
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Vendor rejected successfully",
          data: vendor,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  suspendVendor = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const vendorId = req.params.id;
      const userId = req?.user?._id as unknown as string;

      try {
        const vendor = await this.vendorService.suspendVendor(vendorId, userId);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Vendor suspended successfully",
          data: vendor,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  deleteVendorProfile = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;

      try {
        await this.vendorService.deleteVendorProfile(userId);
        return res.status(HttpStatus.NO_CONTENT).send();
      } catch (error) {
        throw error;
      }
    },
  );
}
