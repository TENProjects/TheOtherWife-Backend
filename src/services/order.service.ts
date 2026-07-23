/** @format */

import { ClientSession } from "mongoose";
import Order from "../models/order.model.js";
import Meal from "../models/meal.model.js";
import Payment from "../models/payment.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import FinancialSettings from "../models/financialSettings.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import Vendor from "../models/vendor.model.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import { transaction } from "../util/transaction.util.js";
import { WalletService } from "./wallet.service.js";
import { VendorWalletService } from "./vendor-wallet.service.js";

export class OrderService {
  private walletService: WalletService;
  private vendorWalletService: VendorWalletService;

  constructor() {
    this.walletService = new WalletService();
    this.vendorWalletService = new VendorWalletService();
  }

  // Refund Scenario A (Financial & Commission Spec v1.0, section 4.1) —
  // automatic: full customer refund to wallet + full vendor clawback of their
  // 80% cut of this order, no admin action required. Paystack's fee is the
  // only thing TOW actually loses (it's already baked out of what gets
  // refunded/clawed back, since neither side is charged for it).
  private applyAutomaticRefund = async (
    session: ClientSession,
    orderId: string,
    customerId: string,
    orderTotalAmount: number,
    currency: string,
    reason: string,
  ) => {
    const payment = await Payment.findOne({ orderId }).session(session);
    if (!payment) {
      return;
    }

    // Full Customer Total (subtotal + processing fee + VAT), regardless of
    // how much of it was originally paid from wallet vs. Paystack — refunds
    // always land back in the wallet in full (section 4/6.1).
    await this.walletService.creditWalletForRefund(
      session,
      customerId,
      orderId,
      orderTotalAmount,
      currency,
    );

    await this.vendorWalletService.applyVendorClawback(
      session,
      payment._id.toString(),
      reason,
    );

    payment.status = "refunded";
    await payment.save({ session });
  };

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

    const existingOrder = await Order.findOne({
      _id: orderId,
      vendorId: vendor._id,
    });

    if (!existingOrder) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (existingOrder.status !== "paid") {
      throw new BadRequestException(
        "Only paid orders can be rejected",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const order = await transaction.use(
      async (session: ClientSession, currentOrderId: string) => {
        const orderRecord = await Order.findById(currentOrderId).session(session);
        if (!orderRecord) {
          throw new NotFoundException(
            "Order not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        orderRecord.status = "cancelled";
        orderRecord.cancellationReason = "vendor_unavailable";
        orderRecord.paymentStatus = "refunded";
        await orderRecord.save({ session });

        await this.applyAutomaticRefund(
          session,
          orderRecord._id.toString(),
          orderRecord.customerId.toString(),
          orderRecord.totalAmount,
          orderRecord.currency,
          "Vendor rejected order",
        );

        return orderRecord;
      },
    )(orderId);

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "paid",
      currentStatus: "cancelled",
    });

    return { order };
  };

  // Refund Scenario A's other trigger — customer cancels before the vendor
  // has started preparation. "confirmed" is the last status where nothing
  // has been cooked yet; once "preparing", cancellation must go through the
  // admin-mediated RefundRequest flow (Scenario B) instead.
  cancelOrderByCustomer = async (customerId: string, orderId: string) => {
    const existingOrder = await Order.findOne({
      _id: orderId,
      customerId,
    });

    if (!existingOrder) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!["paid", "confirmed"].includes(existingOrder.status)) {
      throw new BadRequestException(
        "This order can no longer be cancelled — the vendor has already started preparing it",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const previousStatus = existingOrder.status;

    const order = await transaction.use(
      async (session: ClientSession, currentOrderId: string) => {
        const orderRecord = await Order.findById(currentOrderId).session(session);
        if (!orderRecord) {
          throw new NotFoundException(
            "Order not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        orderRecord.status = "cancelled";
        orderRecord.cancellationReason = "customer_requested";
        orderRecord.paymentStatus = "refunded";
        await orderRecord.save({ session });

        await this.applyAutomaticRefund(
          session,
          orderRecord._id.toString(),
          orderRecord.customerId.toString(),
          orderRecord.totalAmount,
          orderRecord.currency,
          "Customer cancelled order before preparation",
        );

        return orderRecord;
      },
    )(orderId);

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus,
      currentStatus: "cancelled",
    });

    return { order };
  };

  // Post-acceptance delivery progress — "confirmed" (accepted) is the only
  // valid entry point; each step only advances one stage at a time, mirroring
  // accept/reject's ownership + status-guard + signal-emit shape exactly so
  // push notifications (src/signals/push-notification.signal.ts) and any
  // future consumer of order.status_changed keep working unchanged.
  markOrderPreparing = async (userId: string, orderId: string) => {
    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({ _id: orderId, vendorId: vendor._id });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (order.status !== "confirmed") {
      throw new BadRequestException(
        "Only confirmed orders can be marked as preparing",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    order.status = "preparing";
    await order.save();

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "confirmed",
      currentStatus: "preparing",
    });

    return { order };
  };

  markOrderOutForDelivery = async (userId: string, orderId: string) => {
    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({ _id: orderId, vendorId: vendor._id });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (order.status !== "preparing") {
      throw new BadRequestException(
        "Only orders being prepared can be marked out for delivery",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    order.status = "out_for_delivery";
    await order.save();

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "preparing",
      currentStatus: "out_for_delivery",
    });

    return { order };
  };

  markOrderDelivered = async (userId: string, orderId: string) => {
    const vendor = await this.getVendorByUserId(userId);

    const order = await Order.findOne({ _id: orderId, vendorId: vendor._id });

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (order.status !== "out_for_delivery") {
      throw new BadRequestException(
        "Only orders out for delivery can be marked as delivered",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    order.status = "delivered";
    order.deliveredAt = new Date();
    await order.save();

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: "out_for_delivery",
      currentStatus: "delivered",
    });

    return { order };
  };

  // Admin: list orders across all vendors/customers, optionally filtered by
  // status, with pagination and a flag for orders with a pending refund request.
  getAllOrdersForAdmin = async (filters: {
    status?: string;
    page?: number;
    limit?: number;
  }) => {
    const { status, page = 1, limit = 50 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = {};
    if (status) {
      query.status = status;
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("customerId", "firstName lastName")
        .populate("vendorId", "businessName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      Order.countDocuments(query),
    ]);

    const orderIds = orders.map((order) => order._id);
    const pendingRefunds = await RefundRequest.find({
      orderId: { $in: orderIds },
      status: "pending",
    }).select("orderId");
    const pendingRefundOrderIds = new Set(
      pendingRefunds.map((refund) => refund.orderId.toString()),
    );

    return {
      orders: orders.map((order) => {
        const orderObject = order.toObject() as any;
        const customer = orderObject.customerId;
        const vendor = orderObject.vendorId;
        return {
          _id: orderObject._id,
          vendorName: vendor?.businessName ?? "Unknown vendor",
          customerName: customer
            ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
            : "Unknown customer",
          amount: orderObject.totalAmount,
          status: orderObject.status,
          paymentStatus: orderObject.paymentStatus,
          hasPendingRefundRequest: pendingRefundOrderIds.has(
            orderObject._id.toString(),
          ),
          date: orderObject.createdAt,
        };
      }),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  // Admin: full order detail for any order (unlike getUserOrderById/
  // getVendorOrderById, which are scoped to the requesting customer/vendor).
  getOrderDetailsForAdmin = async (orderId: string) => {
    const order = await Order.findById(orderId)
      .populate("customerId", "firstName lastName email phoneNumber")
      .populate("vendorId", "businessName businessLogoUrl");

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const [enriched] = await this.attachMealImages([order]);
    const pendingRefund = await RefundRequest.findOne({
      orderId: order._id,
      status: "pending",
    }).select("_id");

    return {
      order: enriched,
      pendingRefundRequestId: pendingRefund?._id?.toString() ?? null,
    };
  };

  getPlatformPerformanceMetrics = async () => {
    const settings = await FinancialSettings.findOne().select(
      "orderDelayThresholdMinutes",
    );
    const delayThresholdMinutes = settings?.orderDelayThresholdMinutes ?? 60;
    const delayThresholdDate = new Date(
      Date.now() - delayThresholdMinutes * 60 * 1000,
    );

    const [totalOrders, revenueAgg, delayedCount, refundedCount, succeededCount] =
      await Promise.all([
        Order.countDocuments(),
        Order.aggregate<{ _id: null; revenue: number }>([
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
        ]),
        // Orders still awaiting payment or vendor acceptance past the
        // configured threshold. Post-acceptance delivery progress
        // (confirmed/preparing/out_for_delivery/delivered) isn't counted as
        // "delayed" here — this metric is specifically about orders stuck
        // before the vendor has even acknowledged them.
        Order.countDocuments({
          status: { $in: ["pending_payment", "paid"] },
          createdAt: { $lt: delayThresholdDate },
        }),
        Order.countDocuments({ paymentStatus: "refunded" }),
        Order.countDocuments({ paymentStatus: "paid" }),
      ]);

    const revenue = revenueAgg[0]?.revenue ?? 0;
    const averageOrderValue =
      succeededCount > 0 ? Math.round(revenue / succeededCount) : 0;
    const refundRate =
      totalOrders > 0
        ? Math.round((refundedCount / totalOrders) * 1000) / 10
        : 0;

    return {
      totalOrders,
      revenue,
      delays: delayedCount,
      delayThresholdMinutes,
      refundRate,
      averageOrderValue,
      // No per-status-transition timestamp exists on Order to honestly derive
      // vendor response time, and no order/session-level satisfaction rating
      // is captured anywhere in the schema — explicitly null rather than a
      // fabricated number.
      customerSatisfactionRate: null as number | null,
      vendorResponseTimeMinutes: null as number | null,
    };
  };
}
