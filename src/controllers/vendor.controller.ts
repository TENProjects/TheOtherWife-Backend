/** @format */

import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { VendorService } from "../services/vendor.service.js";
import type { Request, Response } from "express";
import { ApiResponse } from "../util/response.util.js";
import type { VendorOpeningHours } from "../util/vendor-opening-hours.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

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
      const radiusValue = Number(req.query.radius);
      const featuredVendors = await this.vendorService.getFeaturedVendors(
        req.user?.userType === "customer"
          ? (req.user?._id as unknown as string)
          : undefined,
        Number.isFinite(limitValue) ? limitValue : undefined,
        Number.isFinite(radiusValue) && radiusValue > 0
          ? radiusValue
          : undefined,
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

  getPublicVendorDetails = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const vendorId = req.params.id;
      const vendor = await this.vendorService.getPublicVendorDetails(vendorId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        data: vendor,
      } as ApiResponse);
    },
  );

  updateVendorProfile = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          firstName?: string;
          lastName?: string;
          phoneNumber?: string;
          businessName?: string;
          businessDescription?: string;
          businessLogoUrl?: string;
          expoTokens?: string[];
          pushNotificationsEnabled?: boolean;
          cuisines?: string[];
          yearsOfExperience?: number;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;

      const {
        firstName,
        lastName,
        phoneNumber,
        businessName,
        businessDescription,
        businessLogoUrl,
        expoTokens,
        pushNotificationsEnabled,
        cuisines,
        yearsOfExperience,
      } = req.body;

      try {
        const vendor = await this.vendorService.updateVendorProfile(userId, {
          firstName,
          lastName,
          phoneNumber,
          businessName,
          businessDescription,
          businessLogoUrl,
          expoTokens,
          pushNotificationsEnabled,
          cuisines,
          yearsOfExperience,
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

  getVendorAvailability = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      const availability = await this.vendorService.getVendorAvailability(userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor availability fetched successfully",
        data: availability,
      } as ApiResponse);
    },
  );

  updateVendorAvailability = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          isAvailable?: boolean;
          openingHours?: VendorOpeningHours;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      const availability = await this.vendorService.updateVendorAvailability(
        userId,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor availability updated successfully",
        data: availability,
      } as ApiResponse);
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
        logAdminAction({
          adminUserId: userId,
          action: "vendor.approve",
          targetType: "Vendor",
          targetId: vendorId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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
          rejectionReason?: string;
          reason?: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const vendorId = req.params.id;
      const userId = req?.user?._id as unknown as string;
      const userType = req.user?.userType as unknown as string;
      // Two frontend call sites disagree on the field name (rejectionReason
      // vs reason) — accept either rather than requiring a frontend change.
      const rejectionReason = req.body.rejectionReason ?? req.body.reason;

      try {
        const vendor = await this.vendorService.rejectVendor(
          vendorId,
          userId,
          rejectionReason,
          userType,
        );
        logAdminAction({
          adminUserId: userId,
          action: "vendor.reject",
          targetType: "Vendor",
          targetId: vendorId,
          metadata: { rejectionReason },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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
      const userType = req.user?.userType as unknown as string;

      try {
        const vendor = await this.vendorService.suspendVendor(
          vendorId,
          userId,
          userType,
        );
        logAdminAction({
          adminUserId: userId,
          action: "vendor.suspend",
          targetType: "Vendor",
          targetId: vendorId,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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

  // Admin: list all vendors, optionally filtered by ?status=pending|approved|rejected|suspended
  getAllVendorsForAdmin = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const status = req.query.status as string | undefined;
      const vendors = await this.vendorService.getAllVendorsForAdmin(status);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendors fetched successfully",
        data: { vendors },
      } as ApiResponse);
    },
  );

  // Admin: convenience alias for GET /vendors?status=pending
  getPendingVendorsForAdmin = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const vendors = await this.vendorService.getAllVendorsForAdmin("pending");
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Pending vendors fetched successfully",
        data: { vendors },
      } as ApiResponse);
    },
  );

  // Admin: full vendor detail for any approval status (unlike the public
  // GET /vendors/:id, which only returns approved vendors).
  getVendorDetailsForAdmin = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const vendorId = req.params.id;
      const vendor = await this.vendorService.getVendorDetailsForAdmin(vendorId);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor details fetched successfully",
        data: { vendor },
      } as ApiResponse);
    },
  );

  updateVendorInspectionStatus = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        { inspectionStatus: "not_started" | "in_progress" | "completed" }
      >,
      res: Response,
    ): Promise<Response> => {
      const vendorId = req.params.id;
      const { inspectionStatus } = req.body;
      const adminUserId = req.user?._id as unknown as string;

      const result = await this.vendorService.updateVendorInspectionStatus(
        vendorId,
        inspectionStatus,
      );

      logAdminAction({
        adminUserId,
        action: "vendor.inspection_status_update",
        targetType: "Vendor",
        targetId: vendorId,
        metadata: { inspectionStatus },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor inspection status updated successfully",
        data: result,
      } as ApiResponse);
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
