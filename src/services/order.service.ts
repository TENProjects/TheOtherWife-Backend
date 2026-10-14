/** @format */

import mongoose, { ClientSession } from "mongoose";
import Order from "../models/order.model.js";
import Meal from "../models/meal.model.js";
import Payment from "../models/payment.model.js";
import { vendorSplitOf } from "../util/finance-definitions.util.js";
import RefundRequest from "../models/refundRequest.model.js";
import FinancialSettings from "../models/financialSettings.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import Vendor from "../models/vendor.model.js";
import User from "../models/user.model.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import { transaction } from "../util/transaction.util.js";
import { RefundService } from "./refund.service.js";
import { orderPaymentService } from "./order-payment.service.js";
import { getPickupLocationForOrder } from "./order-pickup.service.js";
import {
  customerVisibleOrderFilter,
  unpaidCheckoutFilter,
  vendorVisibleOrderFilter,
} from "../util/order-visibility.util.js";
import { toSafeSearchRegex } from "../util/regex.util.js";

export const ADMIN_ORDER_BUCKETS = [
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
  "unpaid",
] as const;
export type AdminOrderBucket = (typeof ADMIN_ORDER_BUCKETS)[number];

const orderNotFound = () =>
  new NotFoundException(
    "Order not found",
    HttpStatus.NOT_FOUND,
    ErrorCode.RESOURCE_NOT_FOUND,
  );

const invalidTransition = (message: string) =>
  new BadRequestException(message, HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);

// Vendor-driven delivery progress: one stage at a time, each from exactly one
// predecessor. "confirmed" (accept) is the entry point.
const VENDOR_STEPS = {
  accept: {
    from: "paid",
    to: "confirmed",
    error: "Only paid orders can be accepted",
  },
  preparing: {
    from: "confirmed",
    to: "preparing",
    error: "Only confirmed orders can be marked as preparing",
  },
  out_for_delivery: {
    from: "preparing",
    to: "out_for_delivery",
    error: "Only orders being prepared can be marked out for delivery",
  },
  delivered: {
    from: "out_for_delivery",
    to: "delivered",
    error: "Only orders out for delivery can be marked as delivered",
  },
} as const;

type VendorStep = keyof typeof VENDOR_STEPS;

export class OrderService {
  private refundService: RefundService;

  constructor() {
    this.refundService = new RefundService();
  }

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

  // What the vendor actually earns on each order: their 80% of the
  // (discounted) meal subtotal as recorded on the payment, less any clawback
  // (a cancelled or rejected order earns nothing). The order total also holds
  // TOW's service charge, VAT and 20% platform fee, so it must never be shown
  // to a vendor as their earnings.
  private attachVendorEarnings = async (orders: any[]) => {
    const payments = await Payment.find({
      orderId: { $in: orders.map((order) => order._id) },
      context: { $ne: "meal_plan" },
    })
      .select("orderId vendorNetAmount vendorClawbackAmount")
      .lean();
    const paymentByOrderId = new Map(
      payments.map((payment) => [String(payment.orderId), payment]),
    );

    return orders.map((order) => {
      const obj = order.toObject ? order.toObject() : order;
      const payment = paymentByOrderId.get(String(obj._id));
      const net =
        payment?.vendorNetAmount ??
        vendorSplitOf((obj.subtotal ?? 0) - (obj.discountAmount ?? 0)).vendorNetAmount;
      obj.vendorEarnings = Math.max(net - (payment?.vendorClawbackAmount ?? 0), 0);
      return obj;
    });
  };

  // ── Customer ─────────────────────────────────────────────────────────────

  // Order history lists only orders the customer actually paid for (including
  // ones later cancelled/refunded). An unpaid or abandoned checkout is never
  // recorded here.
  getUserOrders = async (customerId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "Customer ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const orders = await Order.find({
      customerId,
      customerHidden: { $ne: true },
      ...customerVisibleOrderFilter(),
    }).sort({ createdAt: -1 });

    return { orders: await this.attachMealImages(orders) };
  };

  // By id the customer can still read their own checkout while it is being
  // paid (the app polls it after Paystack). It is never listed (above), and
  // the exact pick-up address is only attached once the order is paid.
  getUserOrderById = async (customerId: string, orderId: string) => {
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();

    const order = await Order.findOne({
      _id: orderId,
      customerId,
      customerHidden: { $ne: true },
    });

    if (!order) throw orderNotFound();

    const [enriched] = await this.attachMealImages([order]);
    enriched.pickupLocation = await getPickupLocationForOrder(order);

    return { order: enriched };
  };

  // Customer cancels before the vendor has started preparation. "confirmed"
  // is the last status where nothing has been cooked yet; once "preparing",
  // cancellation must go through the customer-initiated RefundRequest flow
  // (createRefundRequest) instead. An UNPAID checkout cancelled through this
  // endpoint (older app builds) is closed via the checkout flow instead — no
  // refund, it was never paid.
  cancelOrderByCustomer = async (customerId: string, orderId: string) => {
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();

    const existing = await Order.findOne({ _id: orderId, customerId }).select(
      "status",
    );
    if (!existing) throw orderNotFound();

    if (existing.status === "pending_payment") {
      await orderPaymentService.cancelCustomerCheckout(customerId, orderId);
      const closed = await Order.findOne({ _id: orderId, customerId });
      return { order: closed };
    }

    const result = await transaction.use(
      async (session: ClientSession, currentOrderId: string) => {
        // Atomic: the status precondition is part of the update, so a vendor
        // accepting/preparing at the same instant can't be overwritten.
        const before = await Order.findOneAndUpdate(
          {
            _id: currentOrderId,
            customerId,
            status: { $in: ["paid", "confirmed"] },
            ...customerVisibleOrderFilter(),
          },
          {
            $set: { status: "cancelled", cancellationReason: "customer_requested" },
          },
          { session, new: false },
        );

        if (!before) {
          throw invalidTransition(
            "This order can no longer be cancelled — the vendor has already started preparing it",
          );
        }

        await this.refundService.openCancellationRefund(session, {
          orderId: before._id.toString(),
          customerId: before.customerId.toString(),
          vendorId: before.vendorId.toString(),
          amount: before.totalAmount,
          reason: "Customer cancelled order before preparation",
        });

        const after = await Order.findById(currentOrderId).session(session);
        return { previousStatus: before.status, order: after! };
      },
    )(orderId);

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: result.order._id.toString(),
      customerUserId: result.order.customerId.toString(),
      vendorId: result.order.vendorId.toString(),
      previousStatus: result.previousStatus,
      currentStatus: "cancelled",
    });

    return { order: result.order };
  };

  // ── Vendor ───────────────────────────────────────────────────────────────

  // Vendors only ever see paid orders — never an unpaid/abandoned checkout.
  getVendorOrders = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const vendor = await this.getVendorByUserId(userId);

    const orders = await Order.find({
      vendorId: vendor._id,
      ...vendorVisibleOrderFilter(),
    })
      .populate("customerId", "firstName lastName email phoneNumber")
      .sort({ createdAt: -1 });

    return { orders: await this.attachVendorEarnings(orders) };
  };

  getVendorOrderById = async (userId: string, orderId: string) => {
    if (!orderId) {
      throw new BadRequestException(
        "Order ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();

    const vendor = await this.getVendorByUserId(userId);

    // A not-yet-paid order 404s exactly like a non-existent one, so its
    // existence can't be probed.
    const order = await Order.findOne({
      _id: orderId,
      vendorId: vendor._id,
      ...vendorVisibleOrderFilter(),
    })
      .populate("customerId", "firstName lastName email phoneNumber")
      .populate("vendorId", "businessName businessLogoUrl");

    if (!order) throw orderNotFound();

    const [withEarnings] = await this.attachVendorEarnings([order]);
    return { order: withEarnings };
  };

  // One atomic, guarded step of the vendor's delivery progress.
  private advanceVendorOrder = async (
    userId: string,
    orderId: string,
    step: VendorStep,
  ) => {
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();
    const { from, to, error } = VENDOR_STEPS[step];
    const vendor = await this.getVendorByUserId(userId);

    const $set: Record<string, unknown> = { status: to };
    if (to === "delivered") $set.deliveredAt = new Date();

    const order = await Order.findOneAndUpdate(
      { _id: orderId, vendorId: vendor._id, status: from, ...vendorVisibleOrderFilter() },
      { $set },
      { new: true },
    );

    if (!order) {
      const visible = await Order.exists({
        _id: orderId,
        vendorId: vendor._id,
        ...vendorVisibleOrderFilter(),
      });
      if (!visible) throw orderNotFound();
      throw invalidTransition(error);
    }

    await appSignalDispatcher.emit("order.status_changed", {
      orderId: order._id.toString(),
      customerUserId: order.customerId.toString(),
      vendorId: order.vendorId.toString(),
      previousStatus: from,
      currentStatus: to,
    });

    return { order };
  };

  acceptVendorOrder = async (userId: string, orderId: string) =>
    this.advanceVendorOrder(userId, orderId, "accept");

  rejectVendorOrder = async (userId: string, orderId: string) => {
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();
    const vendor = await this.getVendorByUserId(userId);

    const order = await transaction.use(
      async (session: ClientSession, currentOrderId: string) => {
        const orderRecord = await Order.findOneAndUpdate(
          {
            _id: currentOrderId,
            vendorId: vendor._id,
            status: "paid",
            ...vendorVisibleOrderFilter(),
          },
          {
            $set: { status: "cancelled", cancellationReason: "vendor_unavailable" },
          },
          { session, new: true },
        );

        if (!orderRecord) {
          const visible = await Order.exists({
            _id: currentOrderId,
            vendorId: vendor._id,
            ...vendorVisibleOrderFilter(),
          }).session(session);
          if (!visible) throw orderNotFound();
          throw invalidTransition("Only paid orders can be rejected");
        }

        // paymentStatus stays "paid" — only decideRefundRequest (on admin
        // approval) flips it to "refunded".
        await this.refundService.openCancellationRefund(session, {
          orderId: orderRecord._id.toString(),
          customerId: orderRecord.customerId.toString(),
          vendorId: orderRecord.vendorId.toString(),
          amount: orderRecord.totalAmount,
          reason: "Vendor rejected order",
        });

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

  // Post-acceptance delivery progress — "confirmed" (accepted) is the only
  // valid entry point; each step only advances one stage at a time.
  markOrderPreparing = async (userId: string, orderId: string) =>
    this.advanceVendorOrder(userId, orderId, "preparing");

  markOrderOutForDelivery = async (userId: string, orderId: string) =>
    this.advanceVendorOrder(userId, orderId, "out_for_delivery");

  markOrderDelivered = async (userId: string, orderId: string) =>
    this.advanceVendorOrder(userId, orderId, "delivered");

  // ── Admin ────────────────────────────────────────────────────────────────

  private getDelayThreshold = async () => {
    const settings = await FinancialSettings.findOne().select(
      "orderDelayThresholdMinutes",
    );
    const delayThresholdMinutes = settings?.orderDelayThresholdMinutes ?? 60;
    return {
      delayThresholdMinutes,
      delayThresholdDate: new Date(Date.now() - delayThresholdMinutes * 60 * 1000),
    };
  };

  // "Delayed" = a PAID order the vendor still hasn't accepted, measured from
  // when it was paid (createdAt for legacy rows without paidAt). Unpaid
  // checkouts are never "delayed" — they are not orders yet.
  private delayedCondition = (threshold: Date) => ({
    status: "paid",
    $or: [
      { paidAt: { $lt: threshold } },
      { paidAt: { $exists: false }, createdAt: { $lt: threshold } },
    ],
  });

  // Shared by getAllOrdersForAdmin, getAdminOrderStatusCounts and
  // getPlatformPerformanceMetrics so the tabs, counts and KPIs always agree.
  buildAdminOrderBucketQuery = async (
    bucket: AdminOrderBucket,
  ): Promise<Record<string, any>> => {
    if (bucket === "unpaid") return unpaidCheckoutFilter();
    if (bucket === "completed") {
      return { ...vendorVisibleOrderFilter(), status: "delivered" };
    }
    if (bucket === "cancelled") {
      // Real cancellations of paid orders (including payments that arrived
      // after expiry and are being refunded). Unpaid checkouts → "unpaid".
      return { ...customerVisibleOrderFilter(), status: "cancelled" };
    }

    const { delayThresholdDate } = await this.getDelayThreshold();
    const delayed = this.delayedCondition(delayThresholdDate);

    if (bucket === "delayed") {
      return { ...vendorVisibleOrderFilter(), ...delayed };
    }

    return {
      ...vendorVisibleOrderFilter(),
      status: { $in: ["paid", "confirmed", "preparing", "out_for_delivery"] },
      $nor: [delayed],
    };
  };

  getAdminOrderStatusCounts = async () => {
    const buckets: AdminOrderBucket[] = [
      "in_progress",
      "delayed",
      "completed",
      "cancelled",
      "unpaid",
    ];
    const counts = await Promise.all(
      buckets.map((bucket) =>
        this.buildAdminOrderBucketQuery(bucket).then((q) => Order.countDocuments(q)),
      ),
    );

    return {
      in_progress: counts[0],
      delayed: counts[1],
      completed: counts[2],
      cancelled: counts[3],
      unpaid: counts[4],
    };
  };

  // Admin: list orders across all vendors/customers, optionally filtered by
  // status (a literal Order.status value) or bucket (the admin dashboard's
  // classification, computed via buildAdminOrderBucketQuery), with pagination
  // and a flag for orders with a pending refund request. Admins see every
  // order, including unpaid checkouts (for support).
  getAllOrdersForAdmin = async (filters: {
    status?: string;
    bucket?: AdminOrderBucket;
    search?: string;
    page?: number;
    limit?: number;
  }) => {
    const { status, bucket, search, page = 1, limit = 50 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = bucket
      ? await this.buildAdminOrderBucketQuery(bucket)
      : {};
    if (!bucket && status) {
      query.status = status;
    }

    // Order documents don't store customer/vendor names directly (only
    // refs), so a name search has to resolve to matching User/Vendor _ids
    // first, then OR that in alongside a direct order-id match. The search
    // text is escaped and length-capped (no regex injection / ReDoS).
    if (search && search.trim()) {
      const trimmed = search.trim();
      const regex = toSafeSearchRegex(trimmed);
      const orConditions: Record<string, any>[] = [];

      if (mongoose.Types.ObjectId.isValid(trimmed)) {
        orConditions.push({ _id: trimmed });
      }

      const [matchingCustomers, matchingVendors] = await Promise.all([
        User.find({
          userType: "customer",
          $or: [{ firstName: regex }, { lastName: regex }],
        }).select("_id"),
        Vendor.find({ businessName: regex }).select("_id"),
      ]);

      if (matchingCustomers.length) {
        orConditions.push({
          customerId: { $in: matchingCustomers.map((c) => c._id) },
        });
      }
      if (matchingVendors.length) {
        orConditions.push({
          vendorId: { $in: matchingVendors.map((v) => v._id) },
        });
      }

      // No matches at all — force an empty result set rather than an
      // unfiltered one, since the admin explicitly searched for something.
      const searchOr = orConditions.length ? orConditions : [{ _id: null }];

      // Bucket queries may set their own top-level $or — fold both into
      // $and so bucket + search combine correctly.
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
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
          cancellationReason: orderObject.cancellationReason ?? null,
          fulfillmentType: orderObject.fulfillmentType ?? "delivery",
          paidAt: orderObject.paidAt ?? null,
          hasPendingRefundRequest: pendingRefundOrderIds.has(
            orderObject._id.toString(),
          ),
          date: orderObject.createdAt,
          items: (orderObject.items ?? []).map((item: any) => ({
            mealName: item.mealName,
            quantity: item.quantity,
          })),
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
    if (!mongoose.isValidObjectId(orderId)) throw orderNotFound();

    const order = await Order.findById(orderId)
      .populate("customerId", "firstName lastName email phoneNumber")
      .populate("vendorId", "businessName businessLogoUrl");

    if (!order) throw orderNotFound();

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
    const { delayThresholdMinutes } = await this.getDelayThreshold();

    const [totalOrders, revenueAgg, delayedCount, refundedCount, succeededCount] =
      await Promise.all([
        // Real orders only — unpaid checkouts are not orders.
        Order.countDocuments(vendorVisibleOrderFilter()),
        Order.aggregate<{ _id: null; revenue: number }>([
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
        ]),
        // Paid orders the vendor hasn't accepted within the threshold.
        this.buildAdminOrderBucketQuery("delayed").then((q) =>
          Order.countDocuments(q),
        ),
        Order.countDocuments({ paymentStatus: "refunded" }),
        Order.countDocuments({ paymentStatus: "paid" }),
      ]);

    const revenue = revenueAgg[0]?.revenue ?? 0;
    const averageOrderValue =
      succeededCount > 0 ? Math.round(revenue / succeededCount) : 0;
    const paidOrders = succeededCount + refundedCount;
    const refundRate =
      paidOrders > 0 ? Math.round((refundedCount / paidOrders) * 1000) / 10 : 0;

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
