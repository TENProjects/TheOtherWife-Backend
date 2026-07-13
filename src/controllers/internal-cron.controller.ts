/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { MealPlanFulfillmentService } from "../services/meal-plan-fulfillment.service.js";
import { ApiResponse } from "../util/response.util.js";

export class InternalCronController {
  private mealPlanFulfillmentService: MealPlanFulfillmentService;

  constructor() {
    this.mealPlanFulfillmentService = new MealPlanFulfillmentService();
  }

  processDueMealPlanScheduledMeals = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.mealPlanFulfillmentService.processDueScheduledMeals();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Due scheduled meals processed successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
