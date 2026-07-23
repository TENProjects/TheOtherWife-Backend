/** @format */

import { ClientSession } from "mongoose";
import MealReview from "../models/mealReview.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { transaction } from "../util/transaction.util.js";
import { MealService } from "./meal.service.js";

type Pagination = { page?: number; limit?: number };

const paginate = ({ page = 1, limit = 20 }: Pagination) => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};

export class AdminReviewService {
  private mealService: MealService;

  constructor() {
    this.mealService = new MealService();
  }

  getReviews = async (
    filters: Pagination & {
      vendorId?: string;
      moderationStatus?: string;
      rating?: number;
    },
  ) => {
    const { safeLimit, safePage, skip } = paginate(filters);

    const query: Record<string, unknown> = {};
    if (filters.vendorId) query.vendorId = filters.vendorId;
    if (filters.moderationStatus) query.moderationStatus = filters.moderationStatus;
    if (filters.rating) query.rating = filters.rating;

    const [reviews, total] = await Promise.all([
      MealReview.find(query)
        .populate("customerId", "firstName lastName email")
        .populate("vendorId", "businessName")
        .populate("mealId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      MealReview.countDocuments(query),
    ]);

    return {
      reviews,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  getReviewById = async (reviewId: string) => {
    const review = await MealReview.findById(reviewId)
      .populate("customerId", "firstName lastName email")
      .populate("vendorId", "businessName")
      .populate("mealId", "name");

    if (!review) {
      throw new NotFoundException(
        "Review not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return review;
  };

  updateReviewStatus = transaction.use(
    async (
      session: ClientSession,
      reviewId: string,
      moderationStatus: "visible" | "hidden",
    ) => {
      const review = await MealReview.findById(reviewId).session(session);
      if (!review) {
        throw new NotFoundException(
          "Review not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      review.moderationStatus = moderationStatus;
      await review.save({ session });

      await Promise.all([
        this.mealService.refreshMealRatingAggregate(session, review.mealId),
        this.mealService.refreshVendorRatingAggregate(session, review.vendorId),
      ]);

      return review;
    },
  );

  deleteReview = transaction.use(
    async (session: ClientSession, reviewId: string) => {
      const review = await MealReview.findById(reviewId).session(session);
      if (!review) {
        throw new NotFoundException(
          "Review not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      const { mealId, vendorId } = review;
      await MealReview.deleteOne({ _id: reviewId }).session(session);

      await Promise.all([
        this.mealService.refreshMealRatingAggregate(session, mealId),
        this.mealService.refreshVendorRatingAggregate(session, vendorId),
      ]);

      return { deleted: true };
    },
  );
}
