/** @format */

import mongoose, { ClientSession } from "mongoose";
import {
  PUBLIC_VENDOR_ADDRESS_FIELDS,
  PUBLIC_VENDOR_FIELDS,
  toPublicVendorArea,
  withPublicVendorArea,
} from "../util/public-vendor.util.js";
import { PAID_PAYMENT_STATUSES } from "../util/order-visibility.util.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Meal from "../models/meal.model.js";
import Vendor from "../models/vendor.model.js";
import MealCategory from "../models/mealCategory.model.js";
import { transaction } from "../util/transaction.util.js";
import { SearchRadiusService } from "./search-radius.service.js";
import { isVendorReceivingOrders } from "../util/vendor-opening-hours.util.js";
import Order from "../models/order.model.js";
import MealReview from "../models/mealReview.model.js";
import { spiceLevels } from "../util/spice-level.util.js";

export class MealService {
  private searchRadiusService: SearchRadiusService;
  private featuredMinimumRatings: number;

  constructor() {
    this.searchRadiusService = new SearchRadiusService();
    this.featuredMinimumRatings = 5;
  }

  private calculateWeightedRatingScore = (
    ratingAverage: number,
    ratingCount: number,
    globalAverage: number,
  ) => {
    if (ratingCount <= 0) {
      return 0;
    }

    const minimumConfidence = this.featuredMinimumRatings;
    const score =
      (ratingCount / (ratingCount + minimumConfidence)) * ratingAverage +
      (minimumConfidence / (ratingCount + minimumConfidence)) * globalAverage;

    return Number(score.toFixed(2));
  };

  // Public so admin-review.service.ts can re-run these after a moderation
  // takedown (hide/unhide/delete) — a hidden review must stop dragging the
  // score down the moment it's hidden, not just disappear from display.
  refreshMealRatingAggregate = async (
    session: ClientSession,
    mealId: mongoose.Types.ObjectId,
  ) => {
    const [mealAggregate, globalAggregate] = await Promise.all([
      MealReview.aggregate<{
        _id: mongoose.Types.ObjectId;
        ratingAverage: number;
        ratingCount: number;
      }>([
        {
          $match: {
            mealId,
            moderationStatus: { $ne: "hidden" },
          },
        },
        {
          $group: {
            _id: "$mealId",
            ratingAverage: { $avg: "$rating" },
            ratingCount: { $sum: 1 },
          },
        },
      ]).session(session),
      MealReview.aggregate<{ _id: null; globalAverage: number }>([
        {
          $match: { moderationStatus: { $ne: "hidden" } },
        },
        {
          $group: {
            _id: null,
            globalAverage: { $avg: "$rating" },
          },
        },
      ]).session(session),
    ]);

    const ratingAverage = Number((mealAggregate[0]?.ratingAverage ?? 0).toFixed(2));
    const ratingCount = mealAggregate[0]?.ratingCount ?? 0;
    const globalAverage = globalAggregate[0]?.globalAverage ?? ratingAverage;
    const ratingScore = this.calculateWeightedRatingScore(
      ratingAverage,
      ratingCount,
      globalAverage,
    );

    return await Meal.findByIdAndUpdate(
      mealId,
      {
        $set: {
          ratingAverage,
          ratingCount,
          ratingScore,
        },
      },
      { new: true },
    ).session(session);
  };

  refreshVendorRatingAggregate = async (
    session: ClientSession,
    vendorId: mongoose.Types.ObjectId,
  ) => {
    const [vendorAggregate, globalAggregate] = await Promise.all([
      MealReview.aggregate<{
        _id: mongoose.Types.ObjectId;
        ratingAverage: number;
        ratingCount: number;
      }>([
        {
          $match: {
            vendorId,
            moderationStatus: { $ne: "hidden" },
          },
        },
        {
          $group: {
            _id: "$vendorId",
            ratingAverage: { $avg: "$rating" },
            ratingCount: { $sum: 1 },
          },
        },
      ]).session(session),
      MealReview.aggregate<{ _id: null; globalAverage: number }>([
        {
          $match: { moderationStatus: { $ne: "hidden" } },
        },
        {
          $group: {
            _id: null,
            globalAverage: { $avg: "$rating" },
          },
        },
      ]).session(session),
    ]);

    const ratingAverage = Number(
      (vendorAggregate[0]?.ratingAverage ?? 0).toFixed(2),
    );
    const ratingCount = vendorAggregate[0]?.ratingCount ?? 0;
    const globalAverage = globalAggregate[0]?.globalAverage ?? ratingAverage;
    const ratingScore = this.calculateWeightedRatingScore(
      ratingAverage,
      ratingCount,
      globalAverage,
    );

    return await Vendor.findByIdAndUpdate(
      vendorId,
      {
        $set: {
          ratingAverage,
          ratingCount,
          ratingScore,
        },
      },
      { new: true },
    ).session(session);
  };

  createMeal = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      mealData: {
        name: string;
        description: string;
        price: number;
        originalPrice?: number;
        categoryName: string;
        primaryImageUrl: string;
        tags: string[];
        isAvailable?: boolean;
        publicationStatus?: "draft" | "published";
        preparationType: "freshly_cooked" | "cook_and_freeze" | "both";
        availability?: "daily" | "weekly" | "custom";
        availabilitySchedule?: string[];
        availabilityNote?: string;
        packagingOptions: { name: string; price: number }[];
        proteinOptions: { name: string; price: number }[];
        drinksOptions?: { name: string; price: number }[];
        addOns?: { name: string; price: number }[];
      },
    ) => {
      const {
        name,
        description,
        price,
        originalPrice,
        categoryName,
        primaryImageUrl,
        tags,
        isAvailable,
        publicationStatus,
        preparationType,
        availability,
        availabilitySchedule,
        availabilityNote,
        packagingOptions,
        proteinOptions,
        drinksOptions,
        addOns,
      } = mealData;

      const vendor = await Vendor.findOne({ userId }).session(session);
      if (!vendor) {
        throw new BadRequestException(
          "Vendor not found",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const vendorId = vendor._id;

      const category = await MealCategory.findOne({
        category: categoryName,
      }).session(session);
      if (!category) {
        throw new BadRequestException(
          "Meal category not found",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const categoryId = category._id;

      const [meal] = await Meal.create(
        [
          {
            vendorId,
            name,
            categoryName,
            categoryId,
            description,
            price,
            originalPrice,
            primaryImageUrl,
            tags,
            // A new dish has nothing to hide it from customers by default — the
            // schema-level default of `false` exists for the vendor's later
            // "mark unavailable" toggle, not for meal creation.
            isAvailable: isAvailable ?? true,
            publicationStatus: publicationStatus ?? "draft",
            preparationType,
            availability: availability ?? "daily",
            availabilitySchedule,
            availabilityNote,
            packagingOptions,
            proteinOptions,
            drinksOptions: drinksOptions ?? [],
            addOns: addOns ?? [],
          },
        ],
        { session },
      );

      if (!meal) {
        throw new BadRequestException(
          "Meal not created",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      return { meal };
    },
  );

  updateMeal = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      mealId: string,
      mealData: {
        name?: string;
        description?: string;
        price?: number;
        originalPrice?: number;
        categoryName?: string;
        primaryImageUrl?: string;
        additionalImages?: string[];
        tags?: string[];
        preparationTime?: number;
        servingSize?: string;
        additionalData?: string;
        isAvailable?: boolean;
        publicationStatus?: "draft" | "published";
        preparationType?: "freshly_cooked" | "cook_and_freeze" | "both";
        availability?: "daily" | "weekly" | "custom";
        availabilitySchedule?: string[];
        availabilityNote?: string;
        packagingOptions?: { name: string; price: number }[];
        proteinOptions?: { name: string; price: number }[];
        drinksOptions?: { name: string; price: number }[];
        addOns?: { name: string; price: number }[];
      },
    ) => {
      if (!mealId) {
        throw new BadRequestException(
          "Meal ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const vendor = await Vendor.findOne({ userId }).session(session);
      if (!vendor) {
        throw new BadRequestException(
          "Vendor not found",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const meal = await Meal.findOne({
        _id: mealId,
        vendorId: vendor._id,
        isDeleted: false,
      }).session(session);

      if (!meal) {
        throw new NotFoundException(
          "Meal not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      if (mealData.categoryName) {
        const category = await MealCategory.findOne({
          category: mealData.categoryName,
        }).session(session);

        if (!category) {
          throw new BadRequestException(
            "Meal category not found",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }

        meal.categoryName = mealData.categoryName;
        meal.categoryId = category._id;
      }

      if (mealData.name !== undefined) meal.name = mealData.name;
      if (mealData.description !== undefined)
        meal.description = mealData.description;
      if (mealData.price !== undefined) meal.price = mealData.price;
      if (mealData.originalPrice !== undefined) {
        meal.originalPrice = mealData.originalPrice === 0 ? undefined : mealData.originalPrice;
      }
      if (mealData.primaryImageUrl !== undefined)
        meal.primaryImageUrl = mealData.primaryImageUrl;
      if (mealData.additionalImages !== undefined)
        meal.additionalImages = mealData.additionalImages;
      if (mealData.tags !== undefined) meal.tags = mealData.tags;
      if (mealData.preparationTime !== undefined)
        meal.preparationTime = mealData.preparationTime;
      if (mealData.servingSize !== undefined)
        meal.servingSize = mealData.servingSize;
      if (mealData.additionalData !== undefined)
        meal.additionalData = mealData.additionalData;
      if (mealData.isAvailable !== undefined)
        meal.isAvailable = mealData.isAvailable;
      if (mealData.publicationStatus !== undefined)
        meal.publicationStatus = mealData.publicationStatus;
      if (mealData.preparationType !== undefined)
        meal.preparationType = mealData.preparationType;
      if (mealData.availability !== undefined)
        meal.availability = mealData.availability;
      if (mealData.availabilitySchedule !== undefined)
        meal.availabilitySchedule = mealData.availabilitySchedule;
      if (mealData.availabilityNote !== undefined)
        meal.availabilityNote = mealData.availabilityNote;
      if (mealData.packagingOptions !== undefined)
        meal.packagingOptions = mealData.packagingOptions;
      if (mealData.proteinOptions !== undefined)
        meal.proteinOptions = mealData.proteinOptions;
      if (mealData.drinksOptions !== undefined)
        meal.drinksOptions = mealData.drinksOptions;
      if (mealData.addOns !== undefined) meal.addOns = mealData.addOns;

      await meal.save({ session });

      return { meal };
    },
  );

  deleteMeal = transaction.use(
    async (session: ClientSession, userId: string, mealId: string) => {
      if (!mealId) {
        throw new BadRequestException(
          "Meal ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const vendor = await Vendor.findOne({ userId }).session(session);
      if (!vendor) {
        throw new BadRequestException(
          "Vendor not found",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const meal = await Meal.findOneAndUpdate(
        {
          _id: mealId,
          vendorId: vendor._id,
          isDeleted: false,
        },
        {
          $set: {
            isDeleted: true,
            isAvailable: false,
          },
        },
        { new: true },
      ).session(session);

      if (!meal) {
        throw new NotFoundException(
          "Meal not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      return { meal };
    },
  );

  getMeals = async (
    data: {
      customerUserId?: string;
      search?: string;
      tags?: string[];
      mealId?: string;
      category?: string;
      radiusKm?: number;
    },
    pagination: { pageSize?: number; pageNumber?: number },
  ) => {
    const { customerUserId, search, tags = [], mealId, category, radiusKm } =
      data;
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 10, 1), 50);
    const pageNumber = Math.max(pagination.pageNumber ?? 1, 1);
    const skip = (pageNumber - 1) * pageSize;
    const { vendorIds, strategy, customerAddress, radiusKm: appliedRadiusKm } =
      await this.searchRadiusService.getVendorSearchContext(
        customerUserId,
        radiusKm,
      );
    const activeVendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
    }).select("_id");
    const activeVendorIds = activeVendors.map((vendor) => vendor._id);

    const query: Record<string, any> = {
      isDeleted: false,
      isAvailable: true,
      publicationStatus: "published",
      vendorId: {
        $in: vendorIds
          ? activeVendorIds.filter((vendorId) =>
              vendorIds.some(
                (contextVendorId) =>
                  contextVendorId.toString() === vendorId.toString(),
              ),
            )
          : activeVendorIds,
      },
    };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (Array.isArray(tags) && tags.length > 0) {
      query.tags = { $in: tags };
    }

    if (mealId) {
      query._id = mealId as unknown as mongoose.Types.ObjectId;
    }

    if (category) {
      const mealCategory = await MealCategory.findOne({ category });

      if (!mealCategory) {
        throw new NotFoundException(
          "Meal category not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      query.categoryId = mealCategory._id as unknown as mongoose.Types.ObjectId;
    }

    const meals = await Meal.find(query)
      // Public endpoint: whitelisted vendor fields only, and the vendor's
      // area (never street address/coordinates) — see PUBLIC_VENDOR_FIELDS.
      .populate({
        path: "vendorId",
        select: PUBLIC_VENDOR_FIELDS,
        populate: { path: "addressId", select: PUBLIC_VENDOR_ADDRESS_FIELDS },
      })
      .skip(skip)
      .limit(pageSize)
      .sort({ createdAt: -1 });

    const totalMeals = await Meal.countDocuments(query);
    const totalPages = Math.ceil(totalMeals / pageSize);

    // The populated vendor address carries exact coordinates (read only to
    // be coarsened); replace it with the public area before it leaves here.
    const publicMeals = meals.map((meal) => {
      const mealObject = meal.toJSON() as Record<string, any>;
      return {
        ...mealObject,
        vendorId: withPublicVendorArea(mealObject.vendorId),
      };
    });

    return {
      meals: publicMeals,
      pagination: {
        pageSize,
        pageNumber,
        totalMeals,
        totalPages,
        skip,
      },
      searchRadius: {
        strategy,
        radiusKm: appliedRadiusKm,
        customerAddress,
      },
    };
  };

  getVendorMeals = async (userId: string) => {
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

    const meals = await Meal.find({
      vendorId: vendor._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    return { meals };
  };

  getMealDetails = async (mealId: string) => {
    if (!mealId) {
      throw new BadRequestException(
        "Meal ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const query: Record<string, any> = {
      _id: mealId as unknown as mongoose.Types.ObjectId,
      isDeleted: false,
      publicationStatus: "published",
    };

    const meal = await Meal.findOne(query)
      .populate({
        path: "vendorId",
        select: PUBLIC_VENDOR_FIELDS,
        populate: {
          path: "addressId",
          select: PUBLIC_VENDOR_ADDRESS_FIELDS,
        },
      })
      .populate("categoryId");

    if (!meal) {
      throw new NotFoundException(
        "Meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const vendorDocument = meal.vendorId as any;
    const categoryDocument = meal.categoryId as any;

    if (!isVendorReceivingOrders(vendorDocument)) {
      throw new NotFoundException(
        "Meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return {
      meal: {
        _id: meal._id,
        name: meal.name,
        categoryName: meal.categoryName,
        description: meal.description,
        price: meal.price,
        originalPrice: meal.originalPrice,
        publicationStatus: meal.publicationStatus,
        isAvailable: meal.isAvailable,
        primaryImageUrl: meal.primaryImageUrl,
        additionalImages: meal.additionalImages,
        tags: meal.tags,
        preparationTime: meal.preparationTime,
        servingSize: meal.servingSize,
        additionalData: meal.additionalData,
        preparationType: meal.preparationType,
        availability: meal.availability,
        availabilitySchedule: meal.availabilitySchedule,
        availabilityNote: meal.availabilityNote,
        packagingOptions: meal.packagingOptions,
        proteinOptions: meal.proteinOptions,
        drinksOptions: meal.drinksOptions,
        addOns: meal.addOns,
        spiceLevels,
      },
      vendor: {
        _id: vendorDocument?._id,
        businessName: vendorDocument?.businessName,
        businessDescription: vendorDocument?.businessDescription,
        businessLogoUrl: vendorDocument?.businessLogoUrl,
        // Area only before payment; the exact pick-up address is released
        // on the customer's paid pick-up order.
        address: toPublicVendorArea(vendorDocument?.addressId),
      },
      category: categoryDocument
        ? {
            _id: categoryDocument._id,
            ...("category" in categoryDocument
              ? { category: categoryDocument.category }
              : {}),
          }
        : null,
      ratingSummary: {
        average: meal.ratingAverage,
        count: meal.ratingCount,
        score: meal.ratingScore,
      },
    };
  };

  createMealReview = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      mealId: string,
      body: {
        orderId: string;
        rating: number;
        comment?: string;
      },
    ) => {
      if (!customerId || !mealId) {
        throw new BadRequestException(
          "Customer ID and Meal ID are required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const meal = await Meal.findOne({
        _id: mealId,
        isDeleted: false,
        publicationStatus: "published",
      }).session(session);

      if (!meal) {
        throw new NotFoundException(
          "Meal not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      if (!mongoose.isValidObjectId(body.orderId)) {
        throw new BadRequestException(
          "You can rate a meal once your order has been delivered",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      // Reviews are for food the customer actually received: a delivered,
      // paid order of theirs from this vendor that contains this meal.
      const order = await Order.findOne({
        _id: body.orderId,
        customerId,
        vendorId: meal.vendorId,
        status: "delivered",
        paymentStatus: { $in: [...PAID_PAYMENT_STATUSES] },
        "items.mealId": meal._id,
      }).session(session);

      if (!order) {
        throw new BadRequestException(
          "You can rate a meal once your order has been delivered",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const existingReview = await MealReview.findOne({
        orderId: body.orderId,
        customerId,
        mealId,
      }).session(session);

      if (existingReview) {
        throw new BadRequestException(
          "A review already exists for this meal in this order",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      let review;
      try {
        [review] = await MealReview.create(
          [
            {
              mealId,
              vendorId: meal.vendorId,
              orderId: body.orderId,
              customerId,
              rating: body.rating,
              comment: body.comment,
            },
          ],
          { session },
        );
      } catch (error: any) {
        // The unique { orderId, customerId, mealId } index catches a
        // double-submit that slipped past the check above.
        if (error?.code === 11000) {
          throw new BadRequestException(
            "A review already exists for this meal in this order",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }
        throw error;
      }

      const [updatedMeal, updatedVendor] = await Promise.all([
        this.refreshMealRatingAggregate(
          session,
          meal._id as mongoose.Types.ObjectId,
        ),
        this.refreshVendorRatingAggregate(
          session,
          meal.vendorId as mongoose.Types.ObjectId,
        ),
      ]);

      return {
        review,
        meal: updatedMeal,
        vendor: updatedVendor,
      };
    },
  );
}
