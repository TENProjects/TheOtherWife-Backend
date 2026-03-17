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

  getMeals = handleAsyncControl(
    async (req: Request<{ mealId: string }>, res: Response) => {
      try {
        const pageSizeValue = Number(req.query.pageSize);
        const pageNumberValue = Number(req.query.pageNumber);

        const query = {
          search: req.query.search as string,
          tags:
            typeof req.query.tags === "string"
              ? req.query.tags.split(",").map((tag) => tag.trim())
              : (req.query.tags as string[] | undefined),
          mealId: req.query.mealId as string,
          category: req.query.category as string,
        };

        const pagination = {
          pageSize: Number.isFinite(pageSizeValue) ? pageSizeValue : undefined,
          pageNumber: Number.isFinite(pageNumberValue)
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
}
