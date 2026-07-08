/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { CartService } from "../services/cart.service.js";
import { ApiResponse } from "../util/response.util.js";
import type { MealCustomization } from "../util/meal-customization.util.js";

export class CartController {
  cartService: CartService;

  constructor() {
    this.cartService = new CartService();
  }

  addToCart = handleAsyncControl(
    async (
      req: Request<
        { mealId: string },
        {},
        { quantity?: number; customization?: MealCustomization }
      >,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;
      const { quantity, customization } = req.body;

      try {
        const cart = await this.cartService.addToCart(
          userId,
          mealId,
          quantity,
          customization,
        );
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Meal added to cart successfully",
          data: cart,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  removeFromCart = handleAsyncControl(
    async (
      req: Request<{ mealId: string }, {}, {}>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;

      try {
        await this.cartService.removeFromCart(userId, mealId);
        return res.status(HttpStatus.NO_CONTENT).send();
      } catch (error) {
        throw error;
      }
    },
  );

  incrementCart = handleAsyncControl(
    async (
      req: Request<{ mealId: string }, {}, {}>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;

      try {
        const cart = await this.cartService.incrementCart(userId, mealId);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Meal incremented in cart successfully",
          data: cart,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  decrementCart = handleAsyncControl(
    async (
      req: Request<{ mealId: string }, {}, {}>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;

      try {
        const cart = await this.cartService.decrementCart(userId, mealId);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Meal decremented in cart successfully",
          data: cart,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  getUserCart = handleAsyncControl(
    async (req: Request<{}, {}, {}>, res: Response): Promise<Response> => {
      const userId = req.user?._id as unknown as string;

      try {
        const cart = await this.cartService.getUserCart(userId);
        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Cart fetched successfully",
          data: cart,
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );
}
