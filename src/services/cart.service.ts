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
  DEFAULT_PACKAGING_OPTIONS,
  DEFAULT_PROTEIN_OPTIONS,
  DEFAULT_ADDON_OPTIONS,
  DEFAULT_DRINK_OPTIONS,
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

// The Figma/brand design always presents a Packaging + Protein picker on the
// meal-details screen, even for meals the vendor hasn't configured per-meal
// options for. When a meal's own list is empty, fall back to this shared
// default catalog (mirrored exactly on the frontend in
// MealDetailsScreen.tsx) so the picker is never empty and pricing is always
// resolved server-side against a known list — never trusted from the client.
const effectiveOptions = (mealOptions: MealOption[], fallback: MealOption[]) =>
  mealOptions.length > 0 ? mealOptions : fallback;

class CartBase {
  resolveCustomization = (
    meal: MealDocument,
    customization: MealCustomization | undefined,
  ): MealCustomization | undefined => {
    // Required-ness is unchanged from before: only meals with a real,
    // vendor-configured catalog force a packaging/protein pick. Plain
    // "quick add" (no customization at all, e.g. from Home/Category) must
    // keep working for every meal, exactly as it did previously.
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

    // Resolution falls back to the shared default catalog when the meal has
    // no real options — this is the actual fix: the meal-details screen's
    // UI always offers a picker (matching the Figma design) even for meals
    // with no vendor-configured options, so a submitted selection must
    // still resolve to a real, server-known price instead of being
    // rejected as "not a valid option."
    const packagingCatalog = effectiveOptions(
      meal.packagingOptions,
      DEFAULT_PACKAGING_OPTIONS,
    );
    const proteinCatalog = effectiveOptions(
      meal.proteinOptions,
      DEFAULT_PROTEIN_OPTIONS,
    );
    const addOnCatalog = effectiveOptions(meal.addOns, DEFAULT_ADDON_OPTIONS);
    const drinkCatalog = effectiveOptions(
      meal.drinksOptions,
      DEFAULT_DRINK_OPTIONS,
    );

    return {
      packaging: customization.packaging
        ? {
            name: customization.packaging.name,
            price: resolveOptionPrice(
              packagingCatalog,
              customization.packaging.name,
            ),
          }
        : undefined,
      spiceLevel: customization.spiceLevel,
      proteinSelections: customization.proteinSelections?.map(
        (selection) => ({
          name: selection.name,
          price: resolveOptionPrice(proteinCatalog, selection.name),
          quantity: selection.quantity ?? 1,
        }),
      ),
      addOnSelections: customization.addOnSelections?.map((selection) => ({
        name: selection.name,
        price: resolveOptionPrice(addOnCatalog, selection.name),
      })),
      drinkSelections: customization.drinkSelections?.map((selection) => ({
        name: selection.name,
        price: resolveOptionPrice(drinkCatalog, selection.name),
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
    let justCreatedWithMeal = false;

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
      justCreatedWithMeal = true;
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

    // The cart-creation branch above already embeds this exact meal at the
    // requested quantity/customization as the cart's first item — re-running
    // the `add` action here would double the quantity it just set. Only
    // skipped for `add`: increment/decrement/remove reaching an empty cart
    // is already an unusual path, and preserving their current behavior here
    // keeps this fix scoped to the bug it targets.
    if (!(justCreatedWithMeal && action === CartActions.add)) {
      action(cart, meal, quantity, resolvedCustomization);
    }
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
