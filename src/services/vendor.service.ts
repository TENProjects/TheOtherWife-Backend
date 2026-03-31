/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import Vendor from "../models/vendor.model.js";
import User from "../models/user.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { transaction } from "../util/transaction.util.js";
import { ClientSession } from "mongoose";
import { SearchRadiusService } from "./search-radius.service.js";

export class VendorService {
  private searchRadiusService: SearchRadiusService;

  constructor() {
    this.searchRadiusService = new SearchRadiusService();
  }

  private featuredVendorMinimumReviews = 5;

  getFeaturedVendors = async (customerUserId?: string, limit?: number) => {
    const normalizedLimit = Math.min(Math.max(limit ?? 6, 1), 20);
    const { vendorIds, strategy, customerAddress } =
      await this.searchRadiusService.getVendorSearchContext(customerUserId);

    const query: Record<string, any> = {
      approvalStatus: "approved",
      ratingCount: { $gte: this.featuredVendorMinimumReviews },
    };

    if (vendorIds) {
      query._id = { $in: vendorIds };
    }

    const vendors = await Vendor.find(query)
      .select(
        "businessName businessDescription businessLogoUrl ratingAverage ratingCount ratingScore addressId",
      )
      .populate("addressId", "city state country")
      .sort({
        ratingScore: -1,
        ratingCount: -1,
        ratingAverage: -1,
      })
      .limit(normalizedLimit);

    return {
      vendors,
      meta: {
        limit: normalizedLimit,
        minimumReviews: this.featuredVendorMinimumReviews,
        searchRadius: {
          strategy,
          customerAddress,
        },
      },
    };
  };

  getVendorProfile = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOne({ userId })
      .populate("userId")
      .populate("addressId");

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { vendor };
  };

  updateVendorProfile = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: {
        firstName: string;
        lastName: string;
        phoneNumber: string;
        businessName: string;
        businessDescription: string;
        businessLogoUrl: string;
      },
    ) => {
      if (!userId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const {
        firstName,
        lastName,
        phoneNumber,
        businessName,
        businessDescription,
        businessLogoUrl,
      } = body;

      const vendorData: Record<string, string> = {};
      const userData: Record<string, string> = {};

      if (firstName) userData.firstName = firstName;
      if (lastName) userData.lastName = lastName;
      if (phoneNumber) userData.phoneNumber = phoneNumber;

      if (businessName) vendorData.businessName = businessName;
      if (businessDescription)
        vendorData.businessDescription = businessDescription;
      if (businessLogoUrl) vendorData.businessLogoUrl = businessLogoUrl;

      const vendor = await Vendor.findOneAndUpdate(
        { userId },
        {
          $set: vendorData,
        },
        {
          new: true,
        },
      ).session(session);

      const user = await User.findOneAndUpdate(
        { _id: userId },
        {
          $set: userData,
        },
        { new: true },
      ).session(session);

      if (!vendor) {
        throw new NotFoundException(
          "Vendor not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      return { ...{ user }, ...{ vendor } };
    },
  );

  approveVendor = async (
    vendorId: string,
    userId: string,
    userType: string,
  ) => {
    if (!vendorId && !userType) {
      throw new BadRequestException(
        "Vendor ID and User ID and User Type are required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const isAdmin = userType === "admin";
    if (!isAdmin) {
      throw new UnauthorizedExceptionError(
        "User is not an admin",
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
      );
    }

    const vendor = await Vendor.findOneAndUpdate(
      { _id: vendorId },
      {
        approvalStatus: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
      },
      { new: true },
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { vendor };
  };

  rejectVendor = async (
    vendorId: string,
    userId: string,
    reason: string | undefined,
  ) => {
    if (!vendorId && !userId) {
      throw new BadRequestException(
        "Vendor ID and User ID are required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOneAndUpdate(
      { _id: vendorId },
      {
        approvalStatus: "rejected",
        rejectionReason: reason,
      },
      { new: true },
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { vendor };
  };

  suspendVendor = async (vendorId: string, userId: string) => {
    if (!vendorId && !userId) {
      throw new BadRequestException(
        "Vendor ID and User ID are required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOneAndUpdate(
      { _id: vendorId },
      {
        approvalStatus: "suspended",
      },
      { new: true },
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { vendor };
  };

  deleteVendorProfile = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOne({ userId });

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (vendor?.approvalStatus === "suspended") {
      throw new BadRequestException(
        "Suspended: profile cannot be deleted",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const deletedUser = await User.findOneAndDelete({ _id: vendor?.userId });

    if (!deletedUser) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    await deletedUser.deleteOne();
    await vendor.deleteOne();
  };
}
