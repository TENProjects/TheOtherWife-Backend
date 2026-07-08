/** @format */

import { Router } from "express";
import { CartController } from "../controllers/cart.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { addToCartSchema } from "../zod-schema/cart.schema.js";

/**
 * @openapi
 * /api/v1/carts/me:
 *   get:
 *     summary: Get current user cart
 *     tags: [Cart]
 *     responses:
 *       "200":
 *         description: Cart fetched successfully
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

/**
 * @openapi
 * /api/v1/carts/{mealId}:
 *   put:
 *     summary: Add meal to cart
 *     description: >-
 *       If the meal has packagingOptions and/or proteinOptions configured,
 *       customization.packaging and customization.proteinSelections (or
 *       customization.customProteinRequests) are required. Submitted option
 *       prices are ignored — the server always resolves the authoritative
 *       price from the meal's current option lists.
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: mealId
 *         required: true
 *         schema:
 *           type: string
 *         description: The meal ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AddToCartRequest"
 *     responses:
 *       "200":
 *         description: Meal added to cart successfully
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

/**
 * @openapi
 * /api/v1/carts/{mealId}:
 *   patch:
 *     summary: Increment meal quantity in cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: mealId
 *         required: true
 *         schema:
 *           type: string
 *         description: The meal ID
 *     responses:
 *       "200":
 *         description: Meal incremented successfully
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

/**
 * @openapi
 * /api/v1/carts/{mealId}/decrement:
 *   patch:
 *     summary: Decrement meal quantity in cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: mealId
 *         required: true
 *         schema:
 *           type: string
 *         description: The meal ID
 *     responses:
 *       "200":
 *         description: Meal decremented successfully
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

/**
 * @openapi
 * /api/v1/carts/{mealId}:
 *   delete:
 *     summary: Delete meal from cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: mealId
 *         required: true
 *         schema:
 *           type: string
 *         description: The meal ID
 *     responses:
 *       "204":
 *         description: Meal deleted from cart successfully
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

export class CartRouter {
  cartController: CartController;
  router: Router;
  constructor() {
    this.cartController = new CartController();
    this.router = Router();
    this.router.use(authMiddleware);
    this.router.use(roleGuardMiddleware(["customer"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/me", this.cartController.getUserCart);
    this.router.put(
      "/:mealId",
      zodValidation(addToCartSchema),
      this.cartController.addToCart,
    );
    this.router.patch("/:mealId", this.cartController.incrementCart);
    this.router.patch("/:mealId/decrement", this.cartController.decrementCart);
    this.router.delete("/:mealId", this.cartController.removeFromCart);
  }
}

export const cartRouter = new CartRouter().router;
