/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Favourites from "../models/favourites.model.js";
import Meal from "../models/meal.model.js";

export class FavouriteService {
  addFavourite = async (customerId: string, mealId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "User not found",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );
    }

    const meal = await Meal.findOne({
      _id: mealId,
      isDeleted: false,
      publicationStatus: "published",
    });

    if (!meal) {
      throw new NotFoundException(
        "Meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const favourites = await Favourites.findOneAndUpdate(
      { customerId },
      {
        $setOnInsert: { customerId },
        $addToSet: { favouriteMeals: meal._id },
      },
      { new: true, upsert: true },
    );

    return favourites;
  };

  removeFavourite = async (customerId: string, mealId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "User not found",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );
    }

    const favourites = await Favourites.findOneAndUpdate(
      { customerId },
      { $pull: { favouriteMeals: mealId } },
      { new: true },
    );

    if (!favourites) {
      throw new NotFoundException(
        "Favourites not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return favourites;
  };

  getFavourites = async (customerId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "User not found",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );
    }

    const favourites = await Favourites.findOne({ customerId }).populate({
      path: "favouriteMeals",
      select:
        "name description price primaryImageUrl vendorId preparationTime ratingAverage ratingCount",
      populate: {
        path: "vendorId",
        select: "businessName businessLogoUrl",
      },
    });

    return { favouriteMeals: favourites?.favouriteMeals ?? [] };
  };
}
