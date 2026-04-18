/** @format */

import { Router } from "express";
import { MealController } from "../controllers/meal.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { statusCheck } from "../middlewares/status-check.middleware.js";
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { uploadMealImages } from "../middlewares/file-upload.middleware.js";
import {
  createMealSchema,
  createMealReviewSchema,
  updateMealSchema,
} from "../zod-schema/meal.schema.js";
import {
  ensureCreateMealImage,
  uploadMealImagesToCloudinary,
} from "../middlewares/cloudinary-upload.middleware.js";

/**
 * @swagger
 * /api/v1/meals:
 *   get:
 *     summary: Get meals by query
 *     tags: [Meal]
 *     parameters:
 *       - name: search
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *       - name: tags
 *         in: query
 *         required: false
 *         description: Comma-separated tags or repeated query params
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *       - name: mealId
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *       - name: category
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *       - name: pageSize
 *         in: query
 *         required: false
 *         schema:
 *           type: number
 *       - name: pageNumber
 *         in: query
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Meal fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Meal"
 */

/**
 * @swagger
 * /api/v1/meals/vendor/my-meals:
 *   get:
 *     summary: Get current vendor meals
 *     tags: [Meal]
 *     description: Requires an authenticated approved vendor account
 *     responses:
 *       200:
 *         description: Vendor meals fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/meals/{id}:
 *   get:
 *     summary: Get meal details
 *     tags: [Meal]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Meal fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/meals/{id}:
 *   put:
 *     summary: Update a meal
 *     tags: [Meal]
 *     description: Requires an authenticated approved vendor account and ownership of the meal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               categoryName: { type: string }
 *               primaryImageUrl: { type: string }
 *               primaryImage:
 *                 type: string
 *                 format: binary
 *               additionalImages:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               preparationTime: { type: number }
 *               servingSize: { type: string }
 *               additionalData: { type: string }
 *               isAvailable:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Meal updated successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   delete:
 *     summary: Delete a meal
 *     tags: [Meal]
 *     description: Requires an authenticated approved vendor account and ownership of the meal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Meal deleted successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/meals/{id}/reviews:
 *   post:
 *     summary: Create a meal review
 *     tags: [Meal]
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
 *             $ref: "#/components/schemas/MealReviewRequest"
 *     responses:
 *       201:
 *         description: Meal review created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/meals:
 *   post:
 *     summary: Create a new meal
 *     tags: [Meal]
 *     description: Requires an authenticated approved vendor account
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *               - price
 *               - categoryName
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               categoryName: { type: string }
 *               primaryImageUrl: { type: string }
 *               primaryImage:
 *                 type: string
 *                 format: binary
 *               additionalImages:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Meal created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "403":
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/403"
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

class MealRouter {
  mealController: MealController;
  router: Router;

  constructor() {
    this.router = Router();
    this.mealController = new MealController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", optionalAuthMiddleware, this.mealController.getMeals);
    this.router.get(
      "/vendor/my-meals",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.mealController.getVendorMeals,
    );
    this.router.get(
      "/:id",
      optionalAuthMiddleware,
      this.mealController.getMealDetails,
    );
    this.router.put(
      "/:id",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      uploadMealImages,
      uploadMealImagesToCloudinary,
      zodValidation(updateMealSchema),
      this.mealController.updateMeal,
    );
    this.router.delete(
      "/:id",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.mealController.deleteMeal,
    );
    this.router.post(
      "/:id/reviews",
      authMiddleware,
      roleGuardMiddleware(["customer"]),
      zodValidation(createMealReviewSchema),
      this.mealController.createMealReview,
    );
    this.router.post(
      "/",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      uploadMealImages,
      uploadMealImagesToCloudinary,
      ensureCreateMealImage,
      zodValidation(createMealSchema),
      this.mealController.createMeal,
    );
  }
}

export const mealRouter = new MealRouter().router;
