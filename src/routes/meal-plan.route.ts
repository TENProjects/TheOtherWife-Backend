/** @format */

import { Router } from "express";
import { MealPlanController } from "../controllers/meal-plan.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  addMealToPlanSchema,
  createMealPlanSchema,
  updateMealPlanSchema,
  updateScheduledMealSchema,
} from "../zod-schema/meal-plan.schema.js";

/**
 * @swagger
 * /api/v1/meal-plans/upcoming-meals:
 *   get:
 *     summary: Get upcoming scheduled meals across all of the customer's plans
 *     tags: [MealPlan]
 *     responses:
 *       "200":
 *         description: Upcoming meals fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         scheduledMeals:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/ScheduledMeal"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans/scheduled-meals/{scheduledMealId}:
 *   get:
 *     summary: Get a single scheduled meal instance
 *     tags: [MealPlan]
 *     parameters:
 *       - name: scheduledMealId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Scheduled meal fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         scheduledMeal:
 *                           $ref: "#/components/schemas/ScheduledMeal"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 *   put:
 *     summary: Edit a single scheduled meal instance (date, time window, or customization)
 *     description: >-
 *       Rejected with 400 if fewer than 12 hours remain before the scheduled
 *       delivery date/time, or if the instance is not in 'scheduled' status.
 *     tags: [MealPlan]
 *     parameters:
 *       - name: scheduledMealId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/UpdateScheduledMealRequest"
 *     responses:
 *       "200":
 *         description: Scheduled meal updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         scheduledMeal:
 *                           $ref: "#/components/schemas/ScheduledMeal"
 *       "400":
 *         description: Bad request (validation error or past the edit cutoff)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/400"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans/scheduled-meals/{scheduledMealId}/cancel:
 *   patch:
 *     summary: Cancel a single scheduled meal instance
 *     description: >-
 *       Rejected with 400 if fewer than 12 hours remain before the scheduled
 *       delivery date/time. Does not move any money (no refund is issued).
 *     tags: [MealPlan]
 *     parameters:
 *       - name: scheduledMealId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Scheduled meal cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         scheduledMeal:
 *                           $ref: "#/components/schemas/ScheduledMeal"
 *       "400":
 *         description: Bad request (past the cancel cutoff)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/400"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans:
 *   get:
 *     summary: Get the current customer's meal plans
 *     tags: [MealPlan]
 *     responses:
 *       "200":
 *         description: Meal plans fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         plans:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/MealPlan"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 *   post:
 *     summary: Create a new meal plan
 *     description: >-
 *       Creates the plan's schedule/payment settings only. No meals are
 *       attached yet — use POST /meal-plans/{id}/meals to add specific meals,
 *       which is what actually generates the ScheduledMeal delivery instances.
 *     tags: [MealPlan]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreateMealPlanRequest"
 *     responses:
 *       "201":
 *         description: Meal plan created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: "#/components/schemas/MealPlan"
 *       "400":
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/400"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans/{id}:
 *   get:
 *     summary: Get a single meal plan and its scheduled meals
 *     tags: [MealPlan]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Meal plan fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         plan:
 *                           $ref: "#/components/schemas/MealPlan"
 *                         scheduledMeals:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/ScheduledMeal"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 *   put:
 *     summary: Update a meal plan's schedule/payment settings
 *     description: >-
 *       Only updates plan-level settings (name, frequency, dates, delivery
 *       time, default customization, payment type). Does not regenerate or
 *       alter already-created ScheduledMeal instances — changes take effect
 *       for future meal additions only.
 *     tags: [MealPlan]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/UpdateMealPlanRequest"
 *     responses:
 *       "200":
 *         description: Meal plan updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: "#/components/schemas/MealPlan"
 *       "400":
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/400"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans/{id}/cancel:
 *   patch:
 *     summary: Cancel an entire meal plan
 *     description: >-
 *       Marks the plan cancelled and cancels all of its future, still
 *       'scheduled' ScheduledMeal instances. Does not move any money.
 *     tags: [MealPlan]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Meal plan cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: "#/components/schemas/MealPlan"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/meal-plans/{id}/meals:
 *   post:
 *     summary: Add a meal to a plan, generating its scheduled delivery instances
 *     description: >-
 *       Computes every delivery date across the plan's date range/frequency
 *       (dates in the past are skipped) and creates one ScheduledMeal per
 *       date. All meals in a plan must belong to the same vendor — the first
 *       meal added locks in the plan's vendor.
 *     tags: [MealPlan]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AddMealToPlanRequest"
 *     responses:
 *       "201":
 *         description: Meal added to plan successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         plan:
 *                           $ref: "#/components/schemas/MealPlan"
 *                         scheduledMeals:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/ScheduledMeal"
 *       "400":
 *         description: Bad request (e.g. vendor mismatch, plan not active)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/400"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

export class MealPlanRouter {
  mealPlanController: MealPlanController;
  router: Router;

  constructor() {
    this.mealPlanController = new MealPlanController();
    this.router = Router();
    this.router.use(authMiddleware);
    this.router.use(roleGuardMiddleware(["customer"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    // Literal-path routes must be registered before "/:id" so Express
    // doesn't match them as an :id param.
    this.router.get(
      "/upcoming-meals",
      this.mealPlanController.getUpcomingMeals,
    );
    this.router.get(
      "/scheduled-meals/:scheduledMealId",
      this.mealPlanController.getScheduledMeal,
    );
    this.router.put(
      "/scheduled-meals/:scheduledMealId",
      zodValidation(updateScheduledMealSchema),
      this.mealPlanController.updateScheduledMeal,
    );
    this.router.patch(
      "/scheduled-meals/:scheduledMealId/cancel",
      this.mealPlanController.cancelScheduledMeal,
    );

    this.router.get("/", this.mealPlanController.getPlans);
    this.router.post(
      "/",
      zodValidation(createMealPlanSchema),
      this.mealPlanController.createPlan,
    );

    this.router.get("/:id", this.mealPlanController.getPlanDetails);
    this.router.put(
      "/:id",
      zodValidation(updateMealPlanSchema),
      this.mealPlanController.updatePlan,
    );
    this.router.patch("/:id/cancel", this.mealPlanController.cancelPlan);
    this.router.post(
      "/:id/meals",
      zodValidation(addMealToPlanSchema),
      this.mealPlanController.addMealToPlan,
    );
  }
}

export const mealPlanRouter = new MealPlanRouter().router;
