/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { MealPlanService } from "../services/meal-plan.service.js";
import { ApiResponse } from "../util/response.util.js";

export class MealPlanController {
  mealPlanService: MealPlanService;

  constructor() {
    this.mealPlanService = new MealPlanService();
  }

  createPlan = handleAsyncControl(
    async (req: Request<{}>, res: Response): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const plan = await this.mealPlanService.createPlan(userId, req.body);

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Meal plan created successfully",
        data: plan,
      } as ApiResponse);
    },
  );

  updatePlan = handleAsyncControl(
    async (
      req: Request<{ id: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const plan = await this.mealPlanService.updatePlan(
        userId,
        req.params.id,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal plan updated successfully",
        data: plan,
      } as ApiResponse);
    },
  );

  cancelPlan = handleAsyncControl(
    async (
      req: Request<{ id: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const plan = await this.mealPlanService.cancelPlan(
        userId,
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal plan cancelled successfully",
        data: plan,
      } as ApiResponse);
    },
  );

  addMealToPlan = handleAsyncControl(
    async (
      req: Request<{ id: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const result = await this.mealPlanService.addMealToPlan(
        userId,
        req.params.id,
        req.body,
      );

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Meal added to plan successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getPlans = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const plans = await this.mealPlanService.getPlans(userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal plans fetched successfully",
        data: plans,
      } as ApiResponse);
    },
  );

  getPlanDetails = handleAsyncControl(
    async (
      req: Request<{ id: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const plan = await this.mealPlanService.getPlanDetails(
        userId,
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal plan fetched successfully",
        data: plan,
      } as ApiResponse);
    },
  );

  getUpcomingMeals = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const upcomingMeals = await this.mealPlanService.getUpcomingMeals(
        userId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Upcoming meals fetched successfully",
        data: upcomingMeals,
      } as ApiResponse);
    },
  );

  getScheduledMeal = handleAsyncControl(
    async (
      req: Request<{ scheduledMealId: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const scheduledMeal = await this.mealPlanService.getScheduledMeal(
        userId,
        req.params.scheduledMealId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Scheduled meal fetched successfully",
        data: scheduledMeal,
      } as ApiResponse);
    },
  );

  updateScheduledMeal = handleAsyncControl(
    async (
      req: Request<{ scheduledMealId: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const scheduledMeal = await this.mealPlanService.updateScheduledMeal(
        userId,
        req.params.scheduledMealId,
        req.body,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Scheduled meal updated successfully",
        data: scheduledMeal,
      } as ApiResponse);
    },
  );

  cancelScheduledMeal = handleAsyncControl(
    async (
      req: Request<{ scheduledMealId: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const scheduledMeal = await this.mealPlanService.cancelScheduledMeal(
        userId,
        req.params.scheduledMealId,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Scheduled meal cancelled successfully",
        data: scheduledMeal,
      } as ApiResponse);
    },
  );
}
