/** @format */

import { HttpStatus } from "../config/http.config.js";
import mongoose, { ClientSession } from "mongoose";
import { ErrorCode } from "../enums/error-code.enum.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import Vendor from "../models/vendor.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import Address from "../models/address.model.js";
import { getStateCentroidCoordinates } from "../util/nigeria-state-coordinates.util.js";
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
import { PaystackSubaccountService } from "./paystack-subaccount.service.js";

export class VendorService {
  private searchRadiusService: SearchRadiusService;
  private paystackSubaccountService: PaystackSubaccountService;

  constructor() {
    this.searchRadiusService = new SearchRadiusService();
    this.paystackSubaccountService = new PaystackSubaccountService();
  }

  // Paystack Split Payment (spec section 3.2) — creates the vendor's
  // subaccount if bank details are already on file and one doesn't exist yet.
  // Failure here must never block approval itself: if bank details aren't
  // saved yet (the common case — they're usually added later via payout
  // settings), or the Paystack call fails, the vendor is simply left without
  // a subaccount for now; saving/updating bank details retries this (see
  // VendorWalletService.updateVendorPayoutSettings).
  private tryCreatePaystackSubaccount = async (vendor: InstanceType<typeof Vendor>) => {
    if (vendor.paystackSubaccountCode) {
      return;
    }

    const bankDetails = vendor.payoutSettings?.bankDetails;
    if (!bankDetails?.bankName || !bankDetails?.accountNumber) {
      return;
    }

    try {
      const { subaccountCode } = await this.paystackSubaccountService.createSubaccount({
        businessName: vendor.businessName || "TheOtherWife Vendor",
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
      });
      vendor.paystackSubaccountCode = subaccountCode;
      vendor.paystackSubaccountError = undefined;
      vendor.paystackSubaccountErrorAt = undefined;
      await vendor.save();
    } catch (error) {
      console.error(
        `Failed to create Paystack subaccount for vendor ${vendor._id.toString()}:`,
        error,
      );
      vendor.paystackSubaccountError =
        error instanceof Error ? error.message : "Unknown error creating Paystack subaccount";
      vendor.paystackSubaccountErrorAt = new Date();
      await vendor.save();
    }
  };

  // Admin-triggered manual retry (e.g. after fixing a bad bank name) — reuses
  // the same no-throw creation path so a repeated failure just updates the
  // stored error instead of raising to the controller.
  retryPaystackSubaccountCreation = async (vendorId: string) => {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    await this.tryCreatePaystackSubaccount(vendor);
    return { vendor };
  };

  getFeaturedVendors = async (
    customerUserId?: string,
    limit?: number,
    radiusKm?: number,
  ) => {
    const normalizedLimit = Math.min(Math.max(limit ?? 6, 1), 20);
    const { vendorIds, strategy, customerAddress, radiusKm: appliedRadiusKm } =
      await this.searchRadiusService.getVendorSearchContext(
        customerUserId,
        radiusKm,
      );

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
          radiusKm: appliedRadiusKm,
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
        cuisines?: string[];
        yearsOfExperience?: number;
        address?: string;
        city?: string;
        state?: string;
        latitude?: number;
        longitude?: number;
        postalCode?: string;
        country?: string;
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
        cuisines,
        yearsOfExperience,
        address,
        city,
        state,
        latitude,
        longitude,
        postalCode,
        country,
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
      // Post-onboarding edits (Edit Business screen) — dot-path updates so
      // the rest of additionalData (location/socials/payout/documents/etc.)
      // is left untouched, matching how onboarding itself only ever touches
      // its own step's slice of additionalData.
      if (cuisines !== undefined) {
        vendorData["additionalData.business.cuisines"] = cuisines;
      }
      if (yearsOfExperience !== undefined) {
        vendorData["additionalData.business.yearsOfExperience"] = yearsOfExperience;
      }

      // Onboarding step 1 never actually created a real Address document
      // for the vendor (only additionalData.location) — this is the Edit
      // Profile path's chance to fix that going forward for anyone who
      // edits their address, on top of whatever step 1 now does directly.
      if (address !== undefined || city !== undefined || state !== undefined) {
        const existingVendor = await Vendor.findOne({ userId })
          .select("addressId")
          .session(session);

        if (existingVendor?.addressId) {
          const addressUpdate: Record<string, any> = {};
          if (address !== undefined) addressUpdate.address = address;
          if (city !== undefined) addressUpdate.city = city;
          if (state !== undefined) addressUpdate.state = state;
          if (postalCode !== undefined) addressUpdate.postalCode = postalCode;
          if (country !== undefined) addressUpdate.country = country;
          if (typeof latitude === "number") addressUpdate.latitude = latitude;
          if (typeof longitude === "number") addressUpdate.longitude = longitude;

          await Address.findByIdAndUpdate(existingVendor.addressId, {
            $set: addressUpdate,
          }).session(session);
        } else if (city && state) {
          const coordinates =
            typeof latitude === "number" && typeof longitude === "number"
              ? { latitude, longitude }
              : getStateCentroidCoordinates(state);

          const [newAddress] = await Address.create(
            [
              {
                userId,
                label: "work",
                address,
                city,
                state,
                country: country || "Nigeria",
                postalCode: postalCode || "000000",
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                isDefault: true,
              },
            ],
            { session },
          );
          vendorData.addressId = newAddress._id;
        }
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

    await this.tryCreatePaystackSubaccount(vendor);

    return { vendor };
  };

  rejectVendor = async (
    vendorId: string,
    userId: string,
    reason: string | undefined,
    userType?: string,
  ) => {
    if (!vendorId && !userId) {
      throw new BadRequestException(
        "Vendor ID and User ID are required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Route-level roleGuardMiddleware(["admin"]) already enforces this — this
    // is defense-in-depth matching approveVendor's existing re-check, in case
    // this service method is ever called from a different, unguarded context.
    if (userType !== undefined && userType !== "admin") {
      throw new UnauthorizedExceptionError(
        "User is not an admin",
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
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

  suspendVendor = async (vendorId: string, userId: string, userType?: string) => {
    if (!vendorId && !userId) {
      throw new BadRequestException(
        "Vendor ID and User ID are required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Defense-in-depth, matching approveVendor's existing re-check.
    if (userType !== undefined && userType !== "admin") {
      throw new UnauthorizedExceptionError(
        "User is not an admin",
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
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

  // Admin-facing vendor list, optionally filtered by approvalStatus (e.g. "pending").
  // Mirrors UserService.getAllVendors' shape (populated userId/addressId +
  // synthesized ratingSummary) so both admin list endpoints stay consistent.
  getAllVendorsForAdmin = async (status?: string) => {
    const query: Record<string, any> = {};
    if (status) {
      query.approvalStatus = status;
    }

    const vendors = await Vendor.find(query)
      .populate("userId", "-passwordHash")
      .populate("addressId")
      // Vendor has no timestamps field — _id embeds creation time, so this
      // still orders newest-first.
      .sort({ _id: -1 })
      .limit(100);

    return vendors.map((vendor) => {
      const vendorObject = vendor.toObject();
      const additionalData = (vendorObject.additionalData ?? {}) as Record<
        string,
        any
      >;
      return {
        ...vendorObject,
        rating: vendorObject.ratingAverage ?? 0,
        applicationDate: additionalData?.onboarding?.submittedAt ?? null,
        ratingSummary: {
          ratingAverage: vendorObject.ratingAverage ?? 0,
          ratingCount: vendorObject.ratingCount ?? 0,
          ratingScore: vendorObject.ratingScore ?? 0,
        },
      };
    });
  };

  // Full admin-facing vendor detail — unlike getPublicVendorDetails, this
  // works for vendors in ANY approvalStatus (pending/rejected/suspended too,
  // not just approved) and includes admin-only fields.
  getVendorDetailsForAdmin = async (vendorId: string) => {
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

    const vendor = await Vendor.findById(vendorId)
      .populate("userId", "-passwordHash")
      .populate("addressId");

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const numberOfOrders = await Order.countDocuments({ vendorId: vendor._id });

    const vendorObject = vendor.toObject();
    const { additionalData, ...vendorFields } = vendorObject as Record<
      string,
      any
    >;
    const additional = (additionalData ?? {}) as Record<string, any>;

    return {
      ...vendorFields,
      numberOfOrders,
      applicationDate: additional?.onboarding?.submittedAt ?? null,
      cuisines: additional?.business?.cuisines ?? [],
      // No dedicated business-type/category field exists anywhere in the
      // vendor schema — only `cuisines` (a different concept: what they
      // cook, not what kind of business they are). Explicitly null rather
      // than fabricating a value.
      businessType: null,
      documents: additional?.documents ?? {
        governmentId: null,
        businessCertificate: null,
        displayImage: null,
      },
      ratingSummary: {
        ratingAverage: vendorFields.ratingAverage ?? 0,
        ratingCount: vendorFields.ratingCount ?? 0,
        ratingScore: vendorFields.ratingScore ?? 0,
      },
    };
  };

  updateVendorInspectionStatus = async (
    vendorId: string,
    inspectionStatus: "not_started" | "in_progress" | "completed",
  ) => {
    if (!vendorId) {
      throw new BadRequestException(
        "Vendor ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await Vendor.findByIdAndUpdate(
      vendorId,
      { $set: { inspectionStatus } },
      { new: true },
    ).select("inspectionStatus businessName");

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { _id: vendor._id, inspectionStatus: vendor.inspectionStatus };
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
