/** @format */

import mongoose, { ClientSession } from "mongoose";
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

  private refreshMealRatingAggregate = async (
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

  private refreshVendorRatingAggregate = async (
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
        categoryName: string;
        primaryImageUrl: string;
        tags: string[];
      },
    ) => {
      const {
        name,
        description,
        price,
        categoryName,
        primaryImageUrl,
        tags,
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
            primaryImageUrl,
            tags,
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
        categoryName?: string;
        primaryImageUrl?: string;
        additionalImages?: string[];
        tags?: string[];
        preparationTime?: number;
        servingSize?: string;
        additionalData?: string;
        isAvailable?: boolean;
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
    },
    pagination: { pageSize?: number; pageNumber?: number },
  ) => {
    const { customerUserId, search, tags = [], mealId, category } = data;
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 10, 1), 50);
    const pageNumber = Math.max(pagination.pageNumber ?? 1, 1);
    const skip = (pageNumber - 1) * pageSize;
    const { vendorIds } =
      await this.searchRadiusService.getVendorSearchContext(customerUserId);
    const activeVendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
    }).select("_id openingHours approvalStatus isAvailable");
    const activeVendorIds = activeVendors
      .filter((vendor) => isVendorReceivingOrders(vendor))
      .map((vendor) => vendor._id);

    const query: Record<string, any> = {
      isDeleted: false,
      isAvailable: true,
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
      .populate("vendorId")
      .skip(skip)
      .limit(pageSize)
      .sort({ createdAt: -1 });

    const totalMeals = await Meal.countDocuments(query);
    const totalPages = Math.ceil(totalMeals / pageSize);

    return {
      meals,
      pagination: {
        pageSize,
        pageNumber,
        totalMeals,
        totalPages,
        skip,
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
      isAvailable: true,
    };

    const meal = await Meal.findOne(query)
      .populate({
        path: "vendorId",
        populate: {
          path: "addressId",
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
        isAvailable: meal.isAvailable,
        primaryImageUrl: meal.primaryImageUrl,
        additionalImages: meal.additionalImages,
        tags: meal.tags,
        preparationTime: meal.preparationTime,
        servingSize: meal.servingSize,
        additionalData: meal.additionalData,
      },
      vendor: {
        _id: vendorDocument?._id,
        businessName: vendorDocument?.businessName,
        businessDescription: vendorDocument?.businessDescription,
        businessLogoUrl: vendorDocument?.businessLogoUrl,
        address: vendorDocument?.addressId
          ? {
              _id: vendorDocument.addressId._id,
              address: vendorDocument.addressId.address,
              city: vendorDocument.addressId.city,
              state: vendorDocument.addressId.state,
              country: vendorDocument.addressId.country,
              postalCode: vendorDocument.addressId.postalCode,
              latitude: vendorDocument.addressId.latitude,
              longitude: vendorDocument.addressId.longitude,
            }
          : null,
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
      }).session(session);

      if (!meal) {
        throw new NotFoundException(
          "Meal not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      const order = await Order.findOne({
        _id: body.orderId,
        customerId,
        vendorId: meal.vendorId,
        status: { $in: ["paid", "confirmed"] },
        "items.mealId": meal._id,
      }).session(session);

      if (!order) {
        throw new BadRequestException(
          "A paid or confirmed order containing this meal is required to leave a review",
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

      const [review] = await MealReview.create(
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
