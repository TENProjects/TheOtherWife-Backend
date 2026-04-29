/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Cart, { CartDocument } from "../models/cart.model.js";
import { CartAction, CartActions } from "../dispatcher/cart.dispatcher.js";
import Meal from "../models/meal.model.js";
import { transaction } from "../util/transaction.util.js";

class CartBase {
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
      meal.totalPrice = meal.price * meal.quantity;
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

    let cart = await Cart.findOne({ customerId }).session(session);

    if (!cart) {
      [cart] = await Cart.create(
        [
          {
            customerId,
            meals: [
              {
                mealId: mealId as unknown as mongoose.Types.ObjectId,
                price: meal.price,
                quantity,
                totalPrice: meal.price * quantity,
              },
            ],
            totalAmount: meal.price * quantity,
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

    action(cart, meal, quantity);
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
    ) =>
      await this.modifyCart(
        session,
        customerId,
        mealId,
        quantity,
        CartActions.add,
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

  getUserCart = async (customerId: string) =>
    (await Cart.findOne({ customerId })) ??
    (() => {
      throw new NotFoundException(
        "Cart not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    })();
}
