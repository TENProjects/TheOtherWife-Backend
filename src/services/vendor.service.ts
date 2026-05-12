/** @format */

import { HttpStatus } from "../config/http.config.js";
import mongoose, { ClientSession } from "mongoose";
import { ErrorCode } from "../enums/error-code.enum.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import Vendor from "../models/vendor.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { transaction } from "../util/transaction.util.js";
import { SearchRadiusService } from "./search-radius.service.js";
import MealReview from "../models/mealReview.model.js";
import Meal from "../models/meal.model.js";
import {
  isVendorOpenAt,
  isVendorReceivingOrders,
  VendorOpeningHours,
} from "../util/vendor-opening-hours.util.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";

export class VendorService {
  private searchRadiusService: SearchRadiusService;

  constructor() {
    this.searchRadiusService = new SearchRadiusService();
  }

  getFeaturedVendors = async (customerUserId?: string, limit?: number) => {
    const normalizedLimit = Math.min(Math.max(limit ?? 6, 1), 20);
    const { vendorIds, strategy, customerAddress } =
      await this.searchRadiusService.getVendorSearchContext(customerUserId);

    const query: Record<string, any> = {
      approvalStatus: "approved",
      isAvailable: { $ne: false },
    };

    if (vendorIds) {
      query._id = { $in: vendorIds };
    }

    const vendors = await Vendor.find(query)
      .select(
        "businessName businessDescription businessLogoUrl approvalStatus isAvailable ratingAverage ratingCount ratingScore addressId openingHours",
      )
      .populate("addressId", "city state country")
      .sort({
        ratingScore: -1,
        ratingCount: -1,
        ratingAverage: -1,
      })
      .limit(normalizedLimit * 3);

    const orderCountByVendorId = new Map<string, number>();
    if (vendors.length > 0) {
      const vendorIds = vendors.map((vendor) => vendor._id);
      const orderCounts = await Order.aggregate<{
        _id: any;
        numberOfOrders: number;
      }>([
        {
          $match: {
            vendorId: { $in: vendorIds },
            status: { $in: ["paid", "confirmed"] },
          },
        },
        {
          $group: {
            _id: "$vendorId",
            numberOfOrders: { $sum: 1 },
          },
        },
      ]);

      orderCounts.forEach((entry) => {
        orderCountByVendorId.set(entry._id.toString(), entry.numberOfOrders);
      });
    }

    const rankedVendors = vendors
      .map((vendor) => {
        const numberOfOrders = orderCountByVendorId.get(vendor._id.toString()) ?? 0;
        return {
          ...vendor.toObject(),
          numberOfOrders,
        };
      })
      .sort((left, right) => {
        if (right.ratingScore !== left.ratingScore) {
          return right.ratingScore - left.ratingScore;
        }

        if (right.numberOfOrders !== left.numberOfOrders) {
          return right.numberOfOrders - left.numberOfOrders;
        }

        if (right.ratingCount !== left.ratingCount) {
          return right.ratingCount - left.ratingCount;
        }

        return right.ratingAverage - left.ratingAverage;
      })
      .slice(0, normalizedLimit);

    return {
      vendors: rankedVendors,
      meta: {
        limit: normalizedLimit,
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

    await appSignalDispatcher.emit("vendor.approved", {
      vendorId: vendor._id.toString(),
      vendorUserId: vendor.userId.toString(),
      approvedByUserId: userId,
    });

    return { vendor };
  };

  getPublicVendorDetails = async (vendorId: string) => {
    if (!vendorId) {
      throw new BadRequestException(
        "Vendor ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (!mongoose.isValidObjectId(vendorId)) {
      throw new BadRequestException(
        "Invalid vendor ID",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOne({
      _id: vendorId,
      approvalStatus: "approved",
    })
      .select(
        "businessName businessDescription businessLogoUrl approvalStatus isAvailable openingHours addressId ratingAverage ratingCount ratingScore additionalData",
      )
      .populate(
        "addressId",
        "address city state country postalCode latitude longitude",
      );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const meals = await Meal.find({
      vendorId: vendor._id,
      publicationStatus: "published",
      isAvailable: true,
      isDeleted: false,
    })
      .select(
        "_id name description price categoryName primaryImageUrl additionalImages preparationTime servingSize tags ratingAverage ratingCount",
      )
      .sort({ categoryName: 1, name: 1 });

    const additionalData = (vendor.additionalData ?? {}) as Record<string, any>;
    const bannerImageUrl =
      additionalData?.documents?.displayImage?.fileUrl ??
      additionalData?.documents?.displayImage?.url ??
      null;

    return {
      vendor: {
        _id: vendor._id,
        businessName: vendor.businessName,
        about: vendor.businessDescription ?? "",
        logoUrl: vendor.businessLogoUrl ?? null,
        bannerImageUrl,
        ratingAverage: vendor.ratingAverage,
        ratingCount: vendor.ratingCount,
        ratingScore: vendor.ratingScore,
        address: vendor.addressId,
      },
      availability: {
        isAvailable: vendor.isAvailable !== false,
        openingHours: vendor.openingHours,
        isOpenNow: isVendorOpenAt(vendor.openingHours),
        isReceivingOrders: isVendorReceivingOrders(vendor),
      },
      meals: {
        items: meals.map((meal) => {
          const mealObject = meal.toObject();
          return {
            ...mealObject,
            category: mealObject.categoryName || "Other",
          };
        }),
        total: meals.length,
      },
    };
  };

  getVendorReviews = async (userId: string) => {
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

    const reviews = await MealReview.find({ vendorId: vendor._id })
      .populate("mealId", "name primaryImageUrl categoryName")
      .populate("customerId", "firstName lastName")
      .sort({ createdAt: -1 });

    return {
      reviews,
      summary: {
        ratingAverage: vendor.ratingAverage,
        ratingCount: vendor.ratingCount,
        ratingScore: vendor.ratingScore,
      },
    };
  };

  getVendorAvailability = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findOne({ userId }).select(
      "isAvailable openingHours approvalStatus",
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return {
      availability: {
        isAvailable: vendor.isAvailable !== false,
        openingHours: vendor.openingHours,
        isOpenNow: isVendorOpenAt(vendor.openingHours),
        isReceivingOrders: isVendorReceivingOrders(vendor),
        approvalStatus: vendor.approvalStatus,
      },
    };
  };

  updateVendorProfile = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: {
        firstName?: string;
        lastName?: string;
        phoneNumber?: string;
        businessName?: string;
        businessDescription?: string;
        businessLogoUrl?: string;
        expoTokens?: string[];
        pushNotificationsEnabled?: boolean;
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
        expoTokens,
        pushNotificationsEnabled,
      } = body;

      const vendorData: Record<string, any> = {};
      const userData: Record<string, string> = {};

      if (firstName) userData.firstName = firstName;
      if (lastName) userData.lastName = lastName;
      if (phoneNumber) userData.phoneNumber = phoneNumber;

      if (businessName) vendorData.businessName = businessName;
      if (businessDescription)
        vendorData.businessDescription = businessDescription;
      if (businessLogoUrl) vendorData.businessLogoUrl = businessLogoUrl;
      if (expoTokens !== undefined) vendorData.expoTokens = expoTokens;
      if (pushNotificationsEnabled !== undefined) {
        vendorData.pushNotificationsEnabled = pushNotificationsEnabled;
      }

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

  updateVendorAvailability = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: { isAvailable?: boolean; openingHours?: VendorOpeningHours },
    ) => {
      if (!userId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const updates: Record<string, boolean | VendorOpeningHours> = {};
      if (body.isAvailable !== undefined) updates.isAvailable = body.isAvailable;
      if (body.openingHours !== undefined) updates.openingHours = body.openingHours;

      const vendor = await Vendor.findOneAndUpdate(
        { userId },
        { $set: updates },
        { new: true },
      )
        .select("isAvailable openingHours approvalStatus")
        .session(session);

      if (!vendor) {
        throw new NotFoundException(
          "Vendor not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      return {
        availability: {
          isAvailable: vendor.isAvailable !== false,
          openingHours: vendor.openingHours,
          isOpenNow: isVendorOpenAt(vendor.openingHours),
          isReceivingOrders: isVendorReceivingOrders(vendor),
          approvalStatus: vendor.approvalStatus,
        },
      };
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
