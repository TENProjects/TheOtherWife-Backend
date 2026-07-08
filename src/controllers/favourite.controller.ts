/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { FavouriteService } from "../services/favourite.service.js";
import { ApiResponse } from "../util/response.util.js";

export class FavouriteController {
  favouriteService: FavouriteService;

  constructor() {
    this.favouriteService = new FavouriteService();
  }

  addFavourite = handleAsyncControl(
    async (
      req: Request<{ mealId: string }, {}, {}>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;

      const favourites = await this.favouriteService.addFavourite(
        userId,
        mealId,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal added to favourites successfully",
        data: favourites,
      } as ApiResponse);
    },
  );

  removeFavourite = handleAsyncControl(
    async (
      req: Request<{ mealId: string }, {}, {}>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const mealId = req.params.mealId;

      const favourites = await this.favouriteService.removeFavourite(
        userId,
        mealId,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Meal removed from favourites successfully",
        data: favourites,
      } as ApiResponse);
    },
  );

  getFavourites = handleAsyncControl(
    async (req: Request<{}, {}, {}>, res: Response): Promise<Response> => {
      const userId = req.user?._id as unknown as string;

      const favourites = await this.favouriteService.getFavourites(userId);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Favourites fetched successfully",
        data: favourites,
      } as ApiResponse);
    },
  );
}
