/** @format */

import crypto from "crypto";
import { ClientSession } from "mongoose";
import Cart from "../models/cart.model.js";
import Meal from "../models/meal.model.js";
import Address from "../models/address.model.js";
import Vendor from "../models/vendor.model.js";
import User from "../models/user.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { transaction } from "../util/transaction.util.js";
import { PaymentService } from "./payment.service.js";
import { isVendorReceivingOrders } from "../util/vendor-opening-hours.util.js";

type CheckoutPaymentProvider = "paystack" | "cash" | "wallet";

type CheckoutItem = {
  mealId: string;
  mealName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  vendorId: string;
};

type CheckoutPricing = {
  subtotal: number;
  deliveryFee: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
};

type CheckoutPreviewResult = {
  cartId: string;
  cartUpdatedAt: string;
  vendor: {
    id: string;
    businessName?: string;
    approvalStatus: string;
    isAvailable: boolean;
    isReceivingOrders: boolean;
  };
  address: {
    id: string;
    label: "home" | "work" | "other";
    address?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  };
  items: CheckoutItem[];
  pricing: CheckoutPricing;
};

export class CheckoutService {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  private getCheckoutContext = async (
    customerId: string,
    addressId: string,
    session?: ClientSession,
  ) => {
    const cartQuery = Cart.findOne({ customerId });

    session && cartQuery.session(session);

    const cart = await cartQuery;

    if (!cart || cart.meals.length === 0) {
      throw new BadRequestException(
        "Cart is empty",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const addressQuery = Address.findOne({ _id: addressId, userId: customerId });
    session && addressQuery.session(session);
    const address = await addressQuery;

    if (!address) {
      throw new NotFoundException(
        "Address not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const mealIds = cart.meals.map((item) => item.mealId);
    const mealsQuery = Meal.find({
      _id: { $in: mealIds },
      isDeleted: false,
      isAvailable: true,
    });
    session && mealsQuery.session(session);
    const meals = await mealsQuery;

    if (meals.length !== cart.meals.length) {
      throw new BadRequestException(
        "Some meals in the cart are no longer available",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const mealsById = new Map(meals.map((meal) => [meal._id.toString(), meal]));
    const vendorIds = new Set<string>();

    const items = cart.meals.map((item) => {
      const meal = mealsById.get(item.mealId.toString());

      if (!meal) {
        throw new NotFoundException(
          "Meal not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      vendorIds.add(meal.vendorId.toString());

      return {
        mealId: meal._id.toString(),
        mealName: meal.name,
        quantity: item.quantity,
        unitPrice: meal.price,
        lineTotal: meal.price * item.quantity,
        vendorId: meal.vendorId.toString(),
      };
    });

    if (vendorIds.size !== 1) {
      throw new BadRequestException(
        "Checkout currently supports items from one vendor per cart",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const [vendorId] = [...vendorIds];
    const vendorQuery = Vendor.findById(vendorId);
    session && vendorQuery.session(session);
    const vendor = await vendorQuery;

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!isVendorReceivingOrders(vendor)) {
      throw new BadRequestException(
        "Vendor is not receiving orders right now",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);

    return {
      cart,
      address,
      vendor,
      items,
      pricing: {
        subtotal,
        deliveryFee: 0,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: subtotal,
        currency: "NGN",
      },
    };
  };

  previewCheckout = async (
    customerId: string,
    addressId: string,
  ): Promise<CheckoutPreviewResult> => {
    const { cart, address, vendor, items, pricing } =
      await this.getCheckoutContext(customerId, addressId);

    return {
      cartId: cart._id.toString(),
      cartUpdatedAt: cart.updatedAt.toISOString(),
      vendor: {
        id: vendor._id.toString(),
        businessName: vendor.businessName,
        approvalStatus: vendor.approvalStatus,
        isAvailable: vendor.isAvailable !== false,
        isReceivingOrders: isVendorReceivingOrders(vendor),
      },
      address: {
        id: address._id.toString(),
        label: address.label,
        address: address.address,
        city: address.city,
        state: address.state,
        country: address.country,
        postalCode: address.postalCode,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      items,
      pricing,
    };
  };

  confirmCheckout = async (
    customerId: string,
    addressId: string,
    cartUpdatedAt: string,
    paymentProvider: CheckoutPaymentProvider = "paystack",
  ) => {
    if (paymentProvider === "wallet") {
      throw new BadRequestException(
        "Wallet payment is not implemented yet",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const user = await User.findById(customerId).select("email");

    if (!user) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    const {
      order,
      payment,
      preview,
    } = await transaction.use(
      async (
        session: ClientSession,
        currentCustomerId: string,
        currentAddressId: string,
        expectedCartUpdatedAt: string,
      ) => {
        const checkoutContext = await this.getCheckoutContext(
          currentCustomerId,
          currentAddressId,
          session,
        );

        if (
          checkoutContext.cart.updatedAt.toISOString() !== expectedCartUpdatedAt
        ) {
          throw new BadRequestException(
            "Cart changed during checkout. Refresh checkout and try again.",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const [newOrder] = await Order.create(
          [
            {
              customerId: currentCustomerId,
              vendorId: checkoutContext.vendor._id,
              cartId: checkoutContext.cart._id,
              currency: checkoutContext.pricing.currency,
              items: checkoutContext.items.map((item) => ({
                mealId: item.mealId,
                mealName: item.mealName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
              })),
              addressSnapshot: {
                label: checkoutContext.address.label,
                address: checkoutContext.address.address,
                city: checkoutContext.address.city,
                state: checkoutContext.address.state,
                country: checkoutContext.address.country,
                postalCode: checkoutContext.address.postalCode,
                latitude: checkoutContext.address.latitude,
                longitude: checkoutContext.address.longitude,
              },
              subtotal: checkoutContext.pricing.subtotal,
              deliveryFee: checkoutContext.pricing.deliveryFee,
              taxAmount: checkoutContext.pricing.taxAmount,
              discountAmount: checkoutContext.pricing.discountAmount,
              totalAmount: checkoutContext.pricing.totalAmount,
              status: "pending_payment",
              paymentStatus: "pending",
            },
          ],
          { session },
        );

        const [newPayment] = await Payment.create(
          [
            {
              orderId: newOrder._id,
              customerId: currentCustomerId,
              provider: paymentProvider,
              reference: `tow_${crypto.randomUUID().replace(/-/g, "")}`,
              amount: checkoutContext.pricing.totalAmount,
              currency: checkoutContext.pricing.currency,
              status:
                paymentProvider === "paystack" ? "initialized" : "pending",
            },
          ],
          { session },
        );

        const previewResult = {
          cartId: checkoutContext.cart._id.toString(),
          cartUpdatedAt: checkoutContext.cart.updatedAt.toISOString(),
          vendor: {
            id: checkoutContext.vendor._id.toString(),
            businessName: checkoutContext.vendor.businessName,
            approvalStatus: checkoutContext.vendor.approvalStatus,
          },
          address: {
            id: checkoutContext.address._id.toString(),
            label: checkoutContext.address.label,
            address: checkoutContext.address.address,
            city: checkoutContext.address.city,
            state: checkoutContext.address.state,
            country: checkoutContext.address.country,
            postalCode: checkoutContext.address.postalCode,
            latitude: checkoutContext.address.latitude,
            longitude: checkoutContext.address.longitude,
          },
          items: checkoutContext.items,
          pricing: checkoutContext.pricing,
        };

        return {
          order: newOrder,
          payment: newPayment,
          preview: previewResult,
        };
      },
    )(customerId, addressId, cartUpdatedAt);

    if (paymentProvider === "cash") {
      const [updatedOrder, updatedPayment] = await Promise.all([
        Order.findByIdAndUpdate(
          order._id,
          {
            $set: {
              status: "confirmed",
              paymentStatus: "pending",
            },
          },
          { new: true },
        ),
        Payment.findByIdAndUpdate(
          payment._id,
          {
            $set: {
              status: "pending",
            },
          },
          { new: true },
        ),
      ]);

      return {
        order: updatedOrder,
        payment: updatedPayment,
        preview,
      };
    }

    try {
      const paymentInitialization =
        await this.paymentService.initializePaystackPayment({
          email: user.email,
          amount: payment.amount,
          reference: payment.reference,
          orderId: order._id.toString(),
          paymentId: payment._id.toString(),
        });

      const updatedPayment = await Payment.findByIdAndUpdate(
        payment._id,
        {
          $set: {
            status: "pending_customer_action",
            accessCode: paymentInitialization.access_code,
            authorizationUrl: paymentInitialization.authorization_url,
            providerPayload: paymentInitialization,
          },
        },
        { new: true },
      );

      return {
        order,
        payment: updatedPayment,
        preview,
      };
    } catch (error) {
      await Promise.all([
        Payment.findByIdAndUpdate(payment._id, {
          $set: { status: "failed" },
        }),
        Order.findByIdAndUpdate(order._id, {
          $set: { status: "payment_failed", paymentStatus: "failed" },
        }),
      ]);
      throw error;
    }
  };
}
