/** @format */

import { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { MealService } from "../services/meal.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";

export class MealController {
  private mealService: MealService;

  constructor() {
    this.mealService = new MealService();
  }

  createMeal = handleAsyncControl(async (req: Request<{}>, res: Response) => {
    try {
      const userId = req?.user?._id as unknown as string;
      const mealData = req.body;
      const meal = await this.mealService.createMeal(userId, mealData);
      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Meal created successfully",
        data: meal,
      } as ApiResponse);
    } catch (error) {
      throw error;
    }
  });

  updateMeal = handleAsyncControl(
    async (
      req: Request<{ id: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      const meal = await this.mealService.updateMeal(
        userId,
        req.params.id,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal updated successfully",
        data: meal,
      } as ApiResponse);
    },
  );

  getMeals = handleAsyncControl(
    async (req: Request<{ mealId: string }>, res: Response) => {
      try {
        const pageSizeValue = Number(req.query.pageSize);
        const pageNumberValue = Number(req.query.pageNumber);

        const query = {
          customerUserId:
            req.user?.userType === "customer"
              ? (req.user?._id as unknown as string)
              : undefined,
          search: req.query.search as string,
          tags:
            typeof req.query.tags === "string"
              ? req.query.tags.split(",").map((tag) => tag.trim())
              : (req.query.tags as string[] | undefined),
          mealId: req.query.mealId as string,
          category: req.query.category as string,
        };

        const pagination = {
          pageSize:
            Number.isFinite(pageSizeValue) && pageSizeValue > 0
              ? pageSizeValue
              : undefined,
          pageNumber:
            Number.isFinite(pageNumberValue) && pageNumberValue > 0
              ? pageNumberValue
              : undefined,
        };

        const meal = await this.mealService.getMeals(query, pagination);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Meals fetched successfully",
          data: meal,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  getVendorMeals = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      const meals = await this.mealService.getVendorMeals(userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Vendor meals fetched successfully",
        data: meals,
      } as ApiResponse);
    },
  );

  getMealDetails = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response) => {
      const meal = await this.mealService.getMealDetails(req.params.id);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal fetched successfully",
        data: meal,
      } as ApiResponse);
    },
  );

  createMealReview = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          orderId: string;
          rating: number;
          comment?: string;
        }
      >,
      res: Response,
    ) => {
      const customerId = req.user?._id as unknown as string;
      const mealReview = await this.mealService.createMealReview(
        customerId,
        req.params.id,
        req.body,
      );

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Meal review created successfully",
        data: mealReview,
      } as ApiResponse);
    },
  );

  deleteMeal = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      await this.mealService.deleteMeal(userId, req.params.id);

      return res.status(HttpStatus.NO_CONTENT).send();
    },
  );
}
