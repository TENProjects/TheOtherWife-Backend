/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Cart, { CartDocument } from "../models/cart.model.js";
import { CartAction, CartActions } from "../dispatcher/cart.dispatcher.js";
import Meal, { MealDocument, MealOption } from "../models/meal.model.js";
import { transaction } from "../util/transaction.util.js";
import {
  computeCustomizationDelta,
  MealCustomization,
} from "../util/meal-customization.util.js";

const resolveOptionPrice = (
  options: MealOption[],
  name: string,
): number => {
  const match = options.find((option) => option.name === name);

  if (!match) {
    throw new BadRequestException(
      `"${name}" is not a valid option for this meal`,
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  return match.price;
};

class CartBase {
  resolveCustomization = (
    meal: MealDocument,
    customization: MealCustomization | undefined,
  ): MealCustomization | undefined => {
    if (
      meal.packagingOptions.length > 0 &&
      !customization?.packaging?.name
    ) {
      throw new BadRequestException(
        "A packaging option is required for this meal",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (
      meal.proteinOptions.length > 0 &&
      !(customization?.proteinSelections?.length ||
        customization?.customProteinRequests?.length)
    ) {
      throw new BadRequestException(
        "A protein selection is required for this meal",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (!customization) {
      return undefined;
    }

    return {
      packaging: customization.packaging
        ? {
            name: customization.packaging.name,
            price: resolveOptionPrice(
              meal.packagingOptions,
              customization.packaging.name,
            ),
          }
        : undefined,
      spiceLevel: customization.spiceLevel,
      proteinSelections: customization.proteinSelections?.map(
        (selection) => ({
          name: selection.name,
          price: resolveOptionPrice(meal.proteinOptions, selection.name),
          quantity: selection.quantity ?? 1,
        }),
      ),
      addOnSelections: customization.addOnSelections?.map((selection) => ({
        name: selection.name,
        price: resolveOptionPrice(meal.addOns, selection.name),
      })),
      drinkSelections: customization.drinkSelections?.map((selection) => ({
        name: selection.name,
        price: resolveOptionPrice(meal.drinksOptions, selection.name),
        quantity: selection.quantity ?? 1,
      })),
      customProteinRequests: customization.customProteinRequests,
      customAddOnRequests: customization.customAddOnRequests,
      customDrinkRequests: customization.customDrinkRequests,
      cookingInstructions: customization.cookingInstructions,
    };
  };

  ensureSingleVendorCart = async (
    session: ClientSession,
    cart: CartDocument,
    mealVendorId: string,
  ) => {
    if (cart.meals.length === 0) {
      return;
    }

    const existingMeals = await Meal.find({
      _id: { $in: cart.meals.map((item) => item.mealId) },
    })
      .select("vendorId")
      .session(session);

    const hasDifferentVendor = existingMeals.some(
      (existingMeal) => existingMeal.vendorId.toString() !== mealVendorId,
    );

    if (hasDifferentVendor) {
      throw new BadRequestException(
        "Cart currently supports meals from one vendor at a time",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  calculateTotalAmount = (cart: CartDocument) => {
    cart.meals.forEach((meal) => {
      const delta = computeCustomizationDelta(meal.customization);
      meal.effectiveUnitPrice = meal.price + delta;
      meal.totalPrice = meal.effectiveUnitPrice * meal.quantity;
    });

    cart.totalAmount = cart.meals.reduce(
      (total, meal) => total + meal.totalPrice,
      0,
    );
  };

  modifyCart = async (
    session: ClientSession,
    customerId: string,
    mealId: string,
    quantity: number = 1,
    action: CartAction,
    customization?: MealCustomization,
  ) => {
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
      isAvailable: true,
    }).session(session);

    if (!meal) {
      throw new NotFoundException(
        "Meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const resolvedCustomization =
      action === CartActions.add
        ? this.resolveCustomization(meal, customization)
        : undefined;

    let cart = await Cart.findOne({ customerId }).session(session);

    if (!cart) {
      const effectiveUnitPrice =
        meal.price + computeCustomizationDelta(resolvedCustomization);

      [cart] = await Cart.create(
        [
          {
            customerId,
            meals: [
              {
                mealId: mealId as unknown as mongoose.Types.ObjectId,
                price: meal.price,
                quantity,
                totalPrice: effectiveUnitPrice * quantity,
                effectiveUnitPrice,
                customization: resolvedCustomization,
              },
            ],
            totalAmount: effectiveUnitPrice * quantity,
          },
        ],
        { session },
      );
    }

    if (
      action === CartActions.add ||
      action === CartActions.increment
    ) {
      await this.ensureSingleVendorCart(
        session,
        cart,
        meal.vendorId.toString(),
      );
    }

    action(cart, meal, quantity, resolvedCustomization);
    this.calculateTotalAmount(cart);
    await cart.save();
    return cart;
  };
}

export class CartService extends CartBase {
  addToCart = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      mealId: string,
      quantity: number = 1,
      customization?: MealCustomization,
    ) =>
      await this.modifyCart(
        session,
        customerId,
        mealId,
        quantity,
        CartActions.add,
        customization,
      ),
  );

  removeFromCart = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      mealId: string,
      quantity: number = 0,
    ) =>
      await this.modifyCart(
        session,
        customerId,
        mealId,
        quantity,
        CartActions.remove,
      ),
  );

  incrementCart = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      mealId: string,
      quantity: number = 1,
    ) =>
      await this.modifyCart(
        session,
        customerId,
        mealId,
        quantity,
        CartActions.increment,
      ),
  );

  decrementCart = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      mealId: string,
      quantity: number = 1,
    ) =>
      await this.modifyCart(
        session,
        customerId,
        mealId,
        quantity,
        CartActions.decrement,
      ),
  );

  getUserCart = async (customerId: string) => {
    const cart = await Cart.findOne({ customerId })
      .populate({
        path: "meals.mealId",
        select:
          "name description price primaryImageUrl vendorId categoryName isAvailable publicationStatus",
        populate: {
          path: "vendorId",
          select: "businessName businessLogoUrl",
        },
      });

    if (!cart) {
      throw new NotFoundException(
        "Cart not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return cart;
  };
}
