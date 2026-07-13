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
import FinancialSettings from "../models/financialSettings.model.js";
import type { OrderDocument } from "../models/order.model.js";
import type { PaymentDocument } from "../models/payment.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { transaction } from "../util/transaction.util.js";
import { PaymentService } from "./payment.service.js";
import { PromoCodeService } from "./promo-code.service.js";
import { isVendorReceivingOrders } from "../util/vendor-opening-hours.util.js";
import { WalletService } from "./wallet.service.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import {
  computeCustomizationDelta,
  MealCustomization,
} from "../util/meal-customization.util.js";

type CheckoutPaymentProvider = "paystack" | "cash" | "wallet";

// Financial & Commission Specification v1.0 (May 2026) — fixed, non-admin-
// configurable rates. See section 8 "Quick Reference".
const MINIMUM_ORDER_VALUE = 2000;
const VAT_RATE_ON_PROCESSING_FEE = 0.075;
const VENDOR_PAYOUT_RATE = 0.8;
const PAYSTACK_FEE_RATE = 0.015;
const PAYSTACK_FEE_FLAT = 100;
const PAYSTACK_FEE_CAP = 2000;

// Section 3.1 — Paystack fee is (Customer Total x 1.5%) + N100, capped at N2000.
export const calculatePaystackFee = (customerTotal: number): number =>
  Math.min(
    Math.round(customerTotal * PAYSTACK_FEE_RATE + PAYSTACK_FEE_FLAT),
    PAYSTACK_FEE_CAP,
  );

type CheckoutItem = {
  mealId: string;
  mealName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  vendorId: string;
  customization?: MealCustomization;
};

type CheckoutPricing = {
  subtotal: number;
  serviceCharge: number;
  deliveryFee: number;
  // VAT on the processing fee only (7.5%, only when admin has toggled it on)
  // — stored in the pre-existing `taxAmount` field/name.
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
  promoCode?: { code: string; discountAmount: number };
};

export class CheckoutService {
  private paymentService: PaymentService;
  private walletService: WalletService;
  private promoCodeService: PromoCodeService;
  private readonly serviceChargeThreshold = 15000;
  private readonly serviceChargeRateBelowThreshold = 0.049;
  private readonly serviceChargeRateAtOrAboveThreshold = 0.029;

  constructor() {
    this.paymentService = new PaymentService();
    this.walletService = new WalletService();
    this.promoCodeService = new PromoCodeService();
  }

  private calculateServiceCharge = (effectiveSubtotal: number) => {
    const rate =
      effectiveSubtotal < this.serviceChargeThreshold
        ? this.serviceChargeRateBelowThreshold
        : this.serviceChargeRateAtOrAboveThreshold;

    return Math.round(effectiveSubtotal * rate);
  };

  private getCheckoutContext = async (
    customerId: string,
    addressId: string,
    promoCode?: string,
    session?: ClientSession,
    redeemPromoCode = false,
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
      publicationStatus: "published",
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
    let hasVendorDiscountInCart = false;

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

      if (meal.originalPrice !== undefined && meal.originalPrice > meal.price) {
        hasVendorDiscountInCart = true;
      }

      const unitPrice =
        meal.price + computeCustomizationDelta(item.customization);

      return {
        mealId: meal._id.toString(),
        mealName: meal.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
        vendorId: meal.vendorId.toString(),
        customization: item.customization,
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

    // Section 3.2 — a vendor without a Paystack subaccount yet is NOT
    // blocked from receiving orders (that would break every existing vendor
    // the moment this ships). Their orders simply skip live Paystack
    // splitting: the full charge lands on the platform account as it always
    // has, and vendorNetAmount/vendorSettledAmount tracking still works
    // correctly for payout via the existing manual VendorPayoutRequest flow.
    // Once they save bank details and a subaccount is created, new orders
    // automatically start splitting instantly.

    const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);

    // Section 2.1 — enforced on the meal subtotal alone; processing fee and
    // VAT never count toward this minimum.
    if (subtotal < MINIMUM_ORDER_VALUE) {
      throw new BadRequestException(
        `Minimum order value is ${MINIMUM_ORDER_VALUE}`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    let discountAmount = 0;
    let appliedPromoCode: { code: string; discountAmount: number } | undefined;

    if (promoCode) {
      const result = redeemPromoCode
        ? await this.promoCodeService.redeemPromoCode(
            session as ClientSession,
            promoCode,
            subtotal,
            hasVendorDiscountInCart,
          )
        : await this.promoCodeService.validatePromoCode(
            promoCode,
            subtotal,
            hasVendorDiscountInCart,
          );

      discountAmount = result.discountAmount;
      appliedPromoCode = { code: promoCode.trim().toUpperCase(), discountAmount };
    }

    // Section 5.1 — processing fee is calculated on the discounted subtotal.
    const effectiveSubtotal = subtotal - discountAmount;
    const serviceCharge = this.calculateServiceCharge(effectiveSubtotal);

    const financialSettings = await FinancialSettings.findOne().session(
      session ?? null,
    );
    const vatEnabled = financialSettings?.vatEnabled ?? false;
    // Section 2.3 — VAT is 7.5% on the processing fee ONLY, never the
    // subtotal or the HomeChef's earnings.
    const taxAmount = vatEnabled
      ? Math.round(serviceCharge * VAT_RATE_ON_PROCESSING_FEE * 100) / 100
      : 0;

    const totalAmount = effectiveSubtotal + serviceCharge + taxAmount;

    return {
      cart,
      address,
      vendor,
      items,
      pricing: {
        subtotal,
        serviceCharge,
        deliveryFee: 0,
        taxAmount,
        discountAmount,
        totalAmount,
        currency: "NGN",
      },
      promoCode: appliedPromoCode,
    };
  };

  previewCheckout = async (
    customerId: string,
    addressId: string,
    promoCode?: string,
  ): Promise<CheckoutPreviewResult> => {
    const { cart, address, vendor, items, pricing, promoCode: appliedPromoCode } =
      await this.getCheckoutContext(customerId, addressId, promoCode);

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
      promoCode: appliedPromoCode,
    };
  };

  confirmCheckout = async (
    customerId: string,
    addressId: string,
    cartUpdatedAt: string,
    useWallet = false,
    paymentProvider: CheckoutPaymentProvider = "paystack",
    promoCode?: string,
  ) => {
    if (paymentProvider === "wallet") {
      throw new BadRequestException(
        "Wallet payment is not implemented yet",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (paymentProvider === "cash" && useWallet) {
      throw new BadRequestException(
        "Wallet split payment is only supported with Paystack for now",
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
      vendorSubaccountCode,
    } = await transaction.use(
      async (
        session: ClientSession,
        currentCustomerId: string,
        currentAddressId: string,
        expectedCartUpdatedAt: string,
        currentPromoCode: string | undefined,
      ) => {
        const checkoutContext = await this.getCheckoutContext(
          currentCustomerId,
          currentAddressId,
          currentPromoCode,
          session,
          true,
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
                customization: item.customization,
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
              serviceCharge: checkoutContext.pricing.serviceCharge,
              deliveryFee: checkoutContext.pricing.deliveryFee,
              taxAmount: checkoutContext.pricing.taxAmount,
              discountAmount: checkoutContext.pricing.discountAmount,
              totalAmount: checkoutContext.pricing.totalAmount,
              walletAmountApplied: 0,
              paystackAmountDue: checkoutContext.pricing.totalAmount,
              status: "pending_payment",
              paymentStatus: "pending",
            },
          ],
          { session },
        );

        let walletAmountApplied = 0;
        let paystackAmountDue = checkoutContext.pricing.totalAmount;

        if (useWallet) {
          const walletSplit = await this.walletService.reserveWalletAmountForOrder(
            session,
            currentCustomerId,
            newOrder._id.toString(),
            checkoutContext.pricing.totalAmount,
            checkoutContext.pricing.currency,
          );

          walletAmountApplied = walletSplit.walletAmountApplied;
          paystackAmountDue = walletSplit.paystackAmountDue;

          newOrder.walletAmountApplied = walletAmountApplied;
          newOrder.paystackAmountDue = paystackAmountDue;
          await newOrder.save({ session });
        }

        // Section 3.2/3.3 — fixed 80/20 split of the (discounted) meal
        // subtotal, never the customer total. The vendor is never charged
        // the Paystack fee, VAT, or the processing fee.
        const effectiveSubtotal =
          checkoutContext.pricing.subtotal - checkoutContext.pricing.discountAmount;
        const vendorNetAmount = Math.max(
          Math.round(effectiveSubtotal * VENDOR_PAYOUT_RATE),
          0,
        );
        const paystackFeeAmount = calculatePaystackFee(
          checkoutContext.pricing.totalAmount,
        );
        const splitPayment =
          paymentProvider === "paystack" &&
          paystackAmountDue > 0 &&
          !!checkoutContext.vendor.paystackSubaccountCode;

        const [newPayment] = await Payment.create(
          [
            {
              orderId: newOrder._id,
              customerId: currentCustomerId,
              vendorId: checkoutContext.vendor._id,
              provider: paymentProvider,
              reference: `tow_${crypto.randomUUID().replace(/-/g, "")}`,
              amount: paystackAmountDue,
              currency: checkoutContext.pricing.currency,
              status:
                paymentProvider === "paystack" && paystackAmountDue > 0
                  ? "initialized"
                  : "pending",
              providerPayload: {
                split: {
                  totalAmount: checkoutContext.pricing.totalAmount,
                  walletAmountApplied,
                  paystackAmountDue,
                },
              },
              vendorGrossAmount: effectiveSubtotal,
              vendorPlatformFeeAmount: effectiveSubtotal - vendorNetAmount,
              vendorNetAmount,
              vendorSettledAmount: 0,
              paystackFeeAmount,
              splitPayment,
              settlementStatus: "ineligible",
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
          pricing: {
            ...checkoutContext.pricing,
            walletAmountApplied,
            paystackAmountDue,
          },
        };

        return {
          order: newOrder,
          payment: newPayment,
          preview: previewResult,
          vendorSubaccountCode: checkoutContext.vendor.paystackSubaccountCode,
        };
      },
    )(customerId, addressId, cartUpdatedAt, promoCode);

    await appSignalDispatcher.emit("order.created", {
      orderId: order._id.toString(),
      customerUserId: customerId,
      vendorId: order.vendorId.toString(),
      totalAmount: order.totalAmount,
      currency: order.currency,
    });

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

      if (updatedOrder) {
        await appSignalDispatcher.emit("order.status_changed", {
          orderId: updatedOrder._id.toString(),
          customerUserId: updatedOrder.customerId.toString(),
          vendorId: updatedOrder.vendorId.toString(),
          previousStatus: "pending_payment",
          currentStatus: "confirmed",
        });
      }

      return {
        order: updatedOrder,
        payment: updatedPayment,
        preview,
      };
    }

    if (payment.amount <= 0) {
      const paidAt = new Date();
      const [updatedOrder, updatedPayment] = (await transaction.use(
        async (
          session: ClientSession,
          orderId: string,
          paymentId: string,
          currentCustomerId: string,
        ) => {
          const orderRecord = await Order.findById(orderId).session(session);
          const paymentRecord = await Payment.findById(paymentId).session(session);

          if (!orderRecord || !paymentRecord) {
            throw new NotFoundException(
              "Order or payment not found",
              HttpStatus.NOT_FOUND,
              ErrorCode.RESOURCE_NOT_FOUND,
            );
          }

          orderRecord.status = "paid";
          orderRecord.paymentStatus = "succeeded";
          orderRecord.paidAt = paidAt;
          await orderRecord.save({ session });

          paymentRecord.status = "succeeded";
          paymentRecord.paidAt = paidAt;
          paymentRecord.settlementStatus = "unsettled";
          paymentRecord.settlementEligibleAt = paidAt;
          paymentRecord.providerPayload = {
            ...(paymentRecord.providerPayload ?? {}),
            walletOnly: true,
          };
          await paymentRecord.save({ session });

          await this.walletService.finalizeReservedWalletForOrder(
            session,
            currentCustomerId,
            orderId,
          );

          await Cart.findOneAndUpdate(
            { customerId: currentCustomerId },
            { $set: { meals: [], totalAmount: 0 } },
            { session },
          );

          return [orderRecord, paymentRecord];
        },
      )(order._id.toString(), payment._id.toString(), customerId) as unknown) as [
        OrderDocument,
        PaymentDocument,
      ];

      await appSignalDispatcher.emit("order.status_changed", {
        orderId: updatedOrder._id.toString(),
        customerUserId: updatedOrder.customerId.toString(),
        vendorId: updatedOrder.vendorId.toString(),
        previousStatus: "pending_payment",
        currentStatus: "paid",
      });

      return {
        order: updatedOrder,
        payment: updatedPayment,
        preview,
      };
    }

    try {
      // Main account keeps everything except the vendor's 80% subtotal cut
      // (service charge + VAT + TOW's 20% commission), floored at 0 in case
      // a wallet payment already covers more than the platform's share.
      const mainAccountShare = payment.splitPayment
        ? Math.max(payment.amount - payment.vendorNetAmount, 0)
        : undefined;

      const paymentInitialization =
        await this.paymentService.initializePaystackPayment({
          email: user.email,
          amount: payment.amount,
          reference: payment.reference,
          orderId: order._id.toString(),
          paymentId: payment._id.toString(),
          subaccountCode: payment.splitPayment ? vendorSubaccountCode : undefined,
          mainAccountShare,
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
      await transaction.use(
        async (
          session: ClientSession,
          orderId: string,
          paymentId: string,
          currentCustomerId: string,
        ) => {
          await Promise.all([
            Payment.findByIdAndUpdate(
              paymentId,
              {
                $set: { status: "failed" },
              },
              { session },
            ),
            Order.findByIdAndUpdate(
              orderId,
              {
                $set: { status: "payment_failed", paymentStatus: "failed" },
              },
              { session },
            ),
          ]);

          await this.walletService.releaseReservedWalletForOrder(
            session,
            currentCustomerId,
            orderId,
          );
        },
      )(order._id.toString(), payment._id.toString(), customerId);
      throw error;
    }
  };
}
