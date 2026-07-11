/** @format */

import Order from "../models/order.model.js";
import Meal from "../models/meal.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import Vendor from "../models/vendor.model.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";

export class OrderService {
  private getVendorByUserId = async (userId: string) => {
    const vendor = await Vendor.findOne({ userId });

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return vendor;
  };

  // Attaches each item's meal image as a sibling `mealImage` field, looked up
  // separately by mealId, so the existing `items.mealId: string` response
  // contract (used elsewhere for order acceptance/reorder/etc.) is never touched.
  private attachMealImages = async (orders: any[]) => {
    const mealIds = Array.from(
      new Set(
        orders.flatMap((order) =>
          (order.items || []).map((item: any) => String(item.mealId)),
        ),
      ),
    );

    const meals = await Meal.find({ _id: { $in: mealIds } }).select(
      "primaryImageUrl",
    );
    const imageByMealId = new Map(
      meals.map((meal) => [String(meal._id), meal.primaryImageUrl]),
    );

    return orders.map((order) => {
      const obj = order.toObject ? order.toObject() : order;
      obj.items = (obj.items || []).map((item: any) => ({
        ...item,
        mealImage: imageByMealId.get(String(item.mealId)),
      }));
      return obj;
    });
  };

  getUserOrders = async (customerId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "Customer ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const orders = await Order.find({ customerId }).sort({ createdAt: -1 });

    return { orders: await this.attachMealImages(orders) };
  };

  getUserOrderById = async (customerId: string, orderId: string) => {
    const order = await Order.findOne({ _id: orderId, customerId });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const [enriched] = await this.attachMealImages([order]);

    return { order: enriched };
  };

  getVendorOrders = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await this.getVendorByUserId(userId);

    const orders = await Order.find({ vendorId: vendor._id })
      .populate("customerId", "firstName lastName email phoneNumber")
      .sort({ createdAt: -1 });

    return { orders };
  };

  getVendorOrderById = async (userId: string, orderId: string) => {
    if (!orderId) {
      throw new BadRequestException(
        "Order ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({ _id: orderId, vendorId: vendor._id })
      .populate("customerId", "firstName lastName email phoneNumber")
      .populate("vendorId", "businessName businessLogoUrl");

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { order };
  };

  acceptVendorOrder = async (userId: string, orderId: string) => {
    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({
      _id: orderId,
      vendorId: vendor._id,
    });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (order.status !== "paid") {
      throw new BadRequestException(
        "Only paid orders can be accepted",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    order.status = "confirmed";
    await order.save();

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "paid",
      currentStatus: "confirmed",
    });

    return { order };
  };

  rejectVendorOrder = async (userId: string, orderId: string) => {
    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({
      _id: orderId,
      vendorId: vendor._id,
    });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (order.status !== "paid") {
      throw new BadRequestException(
        "Only paid orders can be rejected",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    order.status = "vendor_rejected";
    await order.save();

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "paid",
      currentStatus: "vendor_rejected",
    });

    return { order };
  };
}
