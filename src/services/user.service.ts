/** @format */

import { ClientSession } from "mongoose";
import User from "../models/user.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import { transaction } from "../util/transaction.util.js";
import Vendor from "../models/vendor.model.js";
import Customer from "../models/customer.model.js";
import Order from "../models/order.model.js";
import Meal from "../models/meal.model.js";
import FinancialSettings from "../models/financialSettings.model.js";

export class UserService {
  getCurrentUser = async (userId: string) => {
    if (!userId) {
      throw new NotFoundException(
        "User not logged in",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    const user = await User.findById(userId).select("-passwordHash");

    if (!user) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    let address = null;

    if (user.userType === "customer") {
      const customer = await Customer.findOne({ userId: user._id }).populate("addressId");
      address = customer?.addressId ?? null;
    }

    if (user.userType === "vendor") {
      const vendor = await Vendor.findOne({ userId: user._id }).populate("addressId");
      address = vendor?.addressId ?? null;
    }

    return { user, address };
  };

  getAllUsers = async () => {
    const users = await User.find()
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .limit(10);

    if (!users) {
      throw new NotFoundException(
        "Users not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    return users;
  };

  // Internal enum <-> the capitalized labels the admin UI displays/sends.
  private readonly customerGroupLabels: Record<string, string> = {
    new: "New",
    regular: "Regular",
    vip: "VIP",
    at_risk: "At Risk",
    blocked: "Blocked",
  };

  private normalizeCustomerGroup = (input: string): string => {
    const key = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!(key in this.customerGroupLabels)) {
      throw new BadRequestException(
        `Invalid customer group "${input}". Must be one of: VIP, Regular, New, At Risk, Blocked`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    return key;
  };

  // Escapes regex metacharacters in admin-supplied search input before it's
  // used to build a RegExp, so a search query can't inject regex/ReDoS.
  private escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  getAllCustomers = async (
    filters: {
      search?: string;
      group?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { search, group, status, page = 1, limit = 100 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const safePage = Math.max(page, 1);

    const userMatch: Record<string, any> = {
      userType: "customer",
      status: { $ne: "deleted" },
    };

    if (status) {
      const normalizedStatus = status.trim().toLowerCase();
      if (!["active", "suspended", "deleted"].includes(normalizedStatus)) {
        throw new BadRequestException(
          "Invalid status filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      userMatch.status = normalizedStatus;
    }

    if (search && search.trim()) {
      const regex = new RegExp(this.escapeRegex(search.trim()), "i");
      userMatch.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phoneNumber: regex },
      ];
    }

    const matchingUsers = await User.find(userMatch).select("_id");
    const userIds = matchingUsers.map((u) => u._id);

    const customerMatch: Record<string, any> = { userId: { $in: userIds } };
    if (group) {
      customerMatch.customerGroup = this.normalizeCustomerGroup(group);
    }

    const customers = await Customer.find(customerMatch)
      .populate("userId", "-passwordHash")
      .populate("addressId");

    const customerUserIds = customers
      .map((customer) => (customer.userId as any)?._id)
      .filter(Boolean);

    const spendAggregation = await Order.aggregate<{
      _id: any;
      orders: number;
      totalSpent: number;
    }>([
      { $match: { customerId: { $in: customerUserIds } } },
      {
        $group: {
          _id: "$customerId",
          orders: { $sum: 1 },
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "succeeded"] },
                "$totalAmount",
                0,
              ],
            },
          },
        },
      },
    ]);

    const spendByCustomer = new Map(
      spendAggregation.map((entry) => [entry._id.toString(), entry]),
    );

    const enriched = customers
      .map((customer) => {
        const user = customer.userId as any;
        if (!user) return null;

        const spend = spendByCustomer.get(user._id.toString());
        const address = customer.addressId as any;

        return {
          _id: user._id.toString(),
          customerId: customer._id.toString(),
          name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phoneNumber ?? "",
          location: address?.city ?? "",
          orders: spend?.orders ?? 0,
          totalSpent: spend?.totalSpent ?? 0,
          group: this.customerGroupLabels[customer.customerGroup ?? "new"],
          status:
            user.status.charAt(0).toUpperCase() + user.status.slice(1),
          adminNotes: customer.adminNotes ?? "",
          createdAt: user.createdAt,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = {
      totalCustomers: enriched.length,
      activeCustomers: enriched.filter((c) => c.status === "Active").length,
      vipCustomers: enriched.filter((c) => c.group === "VIP").length,
      newThisMonth: enriched.filter(
        (c) =>
          new Date(c.createdAt).getTime() >= startOfThisMonth.getTime(),
      ).length,
    };

    const total = enriched.length;
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const start = (safePage - 1) * safeLimit;
    const paginated = enriched.slice(start, start + safeLimit);

    return {
      customers: paginated,
      stats,
      pagination: { page: safePage, limit: safeLimit, total, totalPages },
    };
  };

  assignCustomerGroup = async (userId: string, groupInput: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const normalizedGroup = this.normalizeCustomerGroup(groupInput);

    const customer = await Customer.findOneAndUpdate(
      { userId },
      { $set: { customerGroup: normalizedGroup } },
      { new: true },
    );

    if (!customer) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return {
      _id: userId,
      group: this.customerGroupLabels[normalizedGroup],
    };
  };

  updateCustomerAdminNotes = async (userId: string, adminNotes: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const customer = await Customer.findOneAndUpdate(
      { userId },
      { $set: { adminNotes: adminNotes ?? "" } },
      { new: true },
    );

    if (!customer) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { _id: userId, adminNotes: customer.adminNotes };
  };

  // Looks up the target's email for an admin-triggered password reset, and
  // guards against resetting a non-customer or already-deleted account.
  getCustomerForPasswordReset = async (userId: string) => {
    const user = await User.findOne({
      _id: userId,
      userType: "customer",
    }).select("email status");

    if (!user) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (user.status === "deleted") {
      throw new BadRequestException(
        "Cannot reset password for a deleted account",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return user.email;
  };

  // Admin: unified customer + vendor directory for the Super Admin "User &
  // Vendor Management" table — merges two collections into one searchable,
  // filterable, paginated list.
  getUserDirectoryForAdmin = async (
    filters: {
      search?: string;
      type?: "customer" | "vendor";
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { search, type, status, page = 1, limit = 50 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);

    const userMatch: Record<string, any> = {
      userType: type ?? { $in: ["customer", "vendor"] },
      status: { $ne: "deleted" },
    };

    if (status) {
      const normalizedStatus = status.trim().toLowerCase();
      if (!["active", "suspended"].includes(normalizedStatus)) {
        throw new BadRequestException(
          "Invalid status filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      userMatch.status = normalizedStatus;
    }

    if (search && search.trim()) {
      const regex = new RegExp(this.escapeRegex(search.trim()), "i");
      userMatch.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phoneNumber: regex },
      ];
    }

    const users = await User.find(userMatch).select("-passwordHash");
    const userIds = users.map((user) => user._id);

    const vendors = await Vendor.find({ userId: { $in: userIds } }).select(
      "userId businessName approvalStatus",
    );
    const vendorByUserId = new Map(
      vendors.map((vendor) => [vendor.userId.toString(), vendor]),
    );

    const directory = users.map((user) => {
      const vendor = vendorByUserId.get(user._id.toString());
      return {
        _id: user._id.toString(),
        name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
        email: user.email,
        type: user.userType === "vendor" ? "Vendor" : "Customer",
        status:
          user.status.charAt(0).toUpperCase() + user.status.slice(1),
        verified:
          user.userType === "vendor"
            ? vendor?.approvalStatus === "approved"
            : user.isEmailVerified,
        vendorBusinessName: vendor?.businessName ?? null,
        joinDate: user.createdAt,
      };
    });

    const total = directory.length;
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const start = (safePage - 1) * safeLimit;
    const paginated = directory.slice(start, start + safeLimit);

    return {
      users: paginated,
      pagination: { page: safePage, limit: safeLimit, total, totalPages },
    };
  };

  // Admin: unified detail for the "User Details" modal — handles both
  // customer and vendor user types generically.
  getUserDetailsForAdmin = async (userId: string) => {
    const user = await User.findById(userId).select("-passwordHash");

    if (!user) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    let location: string | null = null;
    let verified = false;
    let vendorBusinessName: string | null = null;
    let totalOrders = 0;

    if (user.userType === "customer") {
      const customer = await Customer.findOne({ userId: user._id }).populate(
        "addressId",
      );
      location = (customer?.addressId as any)?.city ?? null;
      verified = user.isEmailVerified;
      totalOrders = await Order.countDocuments({ customerId: user._id });
    } else if (user.userType === "vendor") {
      const vendor = await Vendor.findOne({ userId: user._id }).populate(
        "addressId",
      );
      location = (vendor?.addressId as any)?.city ?? null;
      verified = vendor?.approvalStatus === "approved";
      vendorBusinessName = vendor?.businessName ?? null;
      totalOrders = vendor
        ? await Order.countDocuments({ vendorId: vendor._id })
        : 0;
    }

    return {
      _id: user._id.toString(),
      name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      userType: user.userType,
      status: user.status.charAt(0).toUpperCase() + user.status.slice(1),
      statusReason: user.statusReason ?? null,
      verified,
      joinDate: user.createdAt,
      email: user.email,
      phone: user.phoneNumber ?? null,
      location,
      vendorBusinessName,
      totalOrders,
    };
  };

  getAllVendors = async () => {
    const vendors = await Vendor.find()
      .populate("userId", "-passwordHash")
      .populate("addressId")
      // Vendor has no timestamps field — _id embeds creation time.
      .sort({ _id: -1 })
      .limit(50);

    return vendors.map((vendor) => {
      const vendorObject = vendor.toObject();
      return {
        ...vendorObject,
        ratingSummary: {
          ratingAverage: vendorObject.ratingAverage ?? 0,
          ratingCount: vendorObject.ratingCount ?? 0,
          ratingScore: vendorObject.ratingScore ?? 0,
        },
      };
    });
  };

  // Percentage change between two period counts. Returns 100 when going from
  // zero to a positive count (can't divide by zero), 0 when both are zero.
  private percentChange = (current: number, previous: number): number => {
    if (previous === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - previous) / previous) * 100);
  };

  getAdminAnalytics = async () => {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalCustomers,
      customersThisMonth,
      customersLastMonth,
      totalOrders,
      ordersThisMonth,
      ordersLastMonth,
      totalMenus,
      revenueAggregation,
      revenueThisMonthAgg,
      revenueLastMonthAgg,
      vendorStatusAggregation,
    ] = await Promise.all([
      User.countDocuments({
        userType: "customer",
        status: { $ne: "deleted" },
      }),
      User.countDocuments({
        userType: "customer",
        status: { $ne: "deleted" },
        createdAt: { $gte: startOfThisMonth },
      }),
      User.countDocuments({
        userType: "customer",
        status: { $ne: "deleted" },
        createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
      }),
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: startOfThisMonth } }),
      Order.countDocuments({
        createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
      }),
      Meal.countDocuments({ isDeleted: false }),
      Order.aggregate<{ _id: null; totalRevenue: number }>([
        { $match: { paymentStatus: "succeeded" } },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
      ]),
      Order.aggregate<{ _id: null; totalRevenue: number }>([
        {
          $match: {
            paymentStatus: "succeeded",
            createdAt: { $gte: startOfThisMonth },
          },
        },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
      ]),
      Order.aggregate<{ _id: null; totalRevenue: number }>([
        {
          $match: {
            paymentStatus: "succeeded",
            createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
          },
        },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
      ]),
      Vendor.aggregate<{ _id: string; count: number }>([
        {
          $group: {
            _id: "$approvalStatus",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const vendorBreakdown = {
      total: 0,
      pending: 0,
      approved: 0,
      suspended: 0,
      rejected: 0,
    };

    vendorStatusAggregation.forEach((entry) => {
      const key = entry._id as keyof typeof vendorBreakdown;
      if (key in vendorBreakdown) {
        vendorBreakdown[key] = entry.count;
        vendorBreakdown.total += entry.count;
      }
    });

    const totalRevenue = revenueAggregation[0]?.totalRevenue ?? 0;
    const revenueThisMonth = revenueThisMonthAgg[0]?.totalRevenue ?? 0;
    const revenueLastMonth = revenueLastMonthAgg[0]?.totalRevenue ?? 0;

    return {
      totalCustomers,
      totalCustomersChange: this.percentChange(
        customersThisMonth,
        customersLastMonth,
      ),
      totalOrders,
      totalOrdersChange: this.percentChange(ordersThisMonth, ordersLastMonth),
      totalRevenue,
      totalRevenueChange: this.percentChange(
        revenueThisMonth,
        revenueLastMonth,
      ),
      totalMenus,
      // Meal documents don't track a creation timestamp, so a period-over-period
      // change can't be computed from real data — explicitly null rather than a
      // fabricated number.
      totalMenusChange: null,
      vendors: vendorBreakdown,
    };
  };

  // Human-readable label for order statuses shown in "Recent Rejected/Failed
  // Orders" — derived from the real stored status enum, not a captured free-text
  // reason (no order status currently captures one beyond vendor rejection).
  private readonly rejectedOrderStatusLabels: Record<string, string> = {
    vendor_rejected: "Vendor rejected",
    payment_failed: "Payment failed",
    customer_cancelled: "Cancelled by customer",
    expired: "Order expired",
  };

  private resolvePeriodStart = (
    period?: "today" | "week" | "month" | "all",
  ): Date | null => {
    const now = new Date();
    switch (period) {
      case "today":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "week": {
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        return start;
      }
      case "month":
        return new Date(now.getFullYear(), now.getMonth(), 1);
      default:
        return null;
    }
  };

  getAdminOrderAnalytics = async (
    orderSummaryPeriod?: "today" | "week" | "month" | "all",
  ) => {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const orderSummaryPeriodStart = this.resolvePeriodStart(orderSummaryPeriod);

    const [
      statusBreakdown,
      periodStatusBreakdown,
      paymentStatusBreakdown,
      revenueByMonth,
      locationAggregation,
      trendingThisMonth,
      trendingLastMonth,
      rejectedOrders,
      totalOrdersForLocationDist,
      settings,
    ] = await Promise.all([
      Order.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        ...(orderSummaryPeriodStart
          ? [{ $match: { createdAt: { $gte: orderSummaryPeriodStart } } }]
          : []),
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate<{
        _id: { year: number; month: number };
        revenue: number;
        commission: number;
      }>([
        {
          $match: {
            paymentStatus: "succeeded",
            createdAt: { $gte: sixMonthsAgo },
          },
        },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            revenue: { $sum: "$totalAmount" },
            commission: { $sum: "$serviceCharge" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        { $match: { "addressSnapshot.city": { $exists: true, $ne: "" } } },
        { $group: { _id: "$addressSnapshot.city", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate<{ _id: string; orders: number; price: number }>([
        { $match: { createdAt: { $gte: startOfThisMonth } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.mealName",
            orders: { $sum: "$items.quantity" },
            price: { $avg: "$items.unitPrice" },
          },
        },
        { $sort: { orders: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate<{ _id: string; orders: number }>([
        {
          $match: {
            createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
          },
        },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.mealName",
            orders: { $sum: "$items.quantity" },
          },
        },
      ]),
      Order.find({
        status: { $in: Object.keys(this.rejectedOrderStatusLabels) },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("_id createdAt status customerId")
        .populate("customerId", "firstName lastName"),
      Order.countDocuments({
        "addressSnapshot.city": { $exists: true, $ne: "" },
      }),
      FinancialSettings.findOne().select("paymentGateways"),
    ]);

    const lastMonthByMeal = new Map(
      trendingLastMonth.map((entry) => [entry._id, entry.orders]),
    );

    // Only Paystack has a real payment integration (see payment.service.ts) —
    // it's the only gateway fee that represents an actual processing cost,
    // same derivation as FinancialsService.getAnalytics.
    const gatewayFeePercent =
      settings?.paymentGateways?.find((g) => g.key === "paystack")
        ?.transactionFeePercent ?? 0;

    return {
      orderCategories: statusBreakdown.map((entry) => ({
        category: entry._id,
        count: entry.count,
      })),
      paymentStatusBreakdown: paymentStatusBreakdown.map((entry) => ({
        status: entry._id,
        count: entry.count,
      })),
      // Scoped by `orderSummaryPeriod` (today/week/month/all) — defaults to
      // all-time when omitted. orderCategories above is always all-time.
      orderSummary: this.buildOrderSummary(periodStatusBreakdown),
      revenueTrend: revenueByMonth.map((entry) => ({
        month: `${entry._id.year}-${String(entry._id.month).padStart(2, "0")}`,
        revenue: entry.revenue,
        profit: entry.commission - (entry.revenue * gatewayFeePercent) / 100,
      })),
      trendingMenus: trendingThisMonth.map((entry) => ({
        name: entry._id,
        orders: entry.orders,
        price: Math.round(entry.price),
        change: this.percentChange(
          entry.orders,
          lastMonthByMeal.get(entry._id) ?? 0,
        ),
      })),
      locationDist: locationAggregation.map((entry) => ({
        city: entry._id,
        value: entry.count,
        percent:
          totalOrdersForLocationDist > 0
            ? Math.round((entry.count / totalOrdersForLocationDist) * 100)
            : 0,
      })),
      // Gender is not currently captured anywhere in the user/customer schema —
      // returning an empty array rather than fabricating a breakdown.
      genderDist: [] as { gender: string; value: number; percent: number }[],
      rejectedOrders: rejectedOrders.map((order) => {
        const orderDoc = order as any;
        const customer = orderDoc.customerId as
          | { firstName?: string; lastName?: string }
          | null
          | undefined;
        return {
          id: orderDoc._id.toString(),
          date: orderDoc.createdAt,
          status: orderDoc.status,
          customerName: customer
            ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
            : null,
          // Derived from the order's real status enum — no order status
          // currently captures a free-text rejection/failure reason.
          reason: this.rejectedOrderStatusLabels[orderDoc.status] ?? null,
        };
      }),
    };
  };

  // Buckets the raw order status enum into the three coarse categories the
  // admin dashboard displays. "delivered" is the true terminal success state;
  // "confirmed"/"preparing"/"out_for_delivery" are now mid-flight delivery
  // progress (vendors can still advance any order sitting at "confirmed",
  // including ones created before this lifecycle existed).
  private buildOrderSummary = (
    statusBreakdown: { _id: string; count: number }[],
  ) => {
    const summary = { completed: 0, inProgress: 0, cancelled: 0 };
    const cancelledStatuses = new Set([
      "customer_cancelled",
      "vendor_rejected",
      "expired",
      "payment_failed",
    ]);

    statusBreakdown.forEach(({ _id: status, count }) => {
      if (status === "delivered") summary.completed += count;
      else if (cancelledStatuses.has(status)) summary.cancelled += count;
      else summary.inProgress += count; // pending_payment, paid, confirmed, preparing, out_for_delivery
    });

    return summary;
  };

  closeCurrentUserAccount = transaction.use(
    async (session: ClientSession, userId: string, password: string) => {
      if (!userId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      if (!password) {
        throw new BadRequestException(
          "Password is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const user = await User.findById(userId).session(session);

      if (!user) {
        throw new NotFoundException(
          "User not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.AUTH_USER_NOT_FOUND,
        );
      }

      const isValidPassword = await user.comparePassword(password);

      if (!isValidPassword) {
        throw new UnauthorizedExceptionError(
          "Incorrect password",
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
        );
      }

      user.status = "deleted";
      user.refreshToken = "";
      user.emailToken = "";
      user.otp = "";
      user.refreshTokenExpiry = new Date(Date.now() - 1000);
      user.emailTokenExpiry = new Date(Date.now() - 1000);
      user.otpExpiry = new Date(Date.now() - 1000);
      await user.save({ session });

      if (user.userType === "vendor") {
        await Vendor.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              approvalStatus: "suspended",
            },
          },
          { session },
        );
      }

      return { user: user.omitPassword() };
    },
  );

  updateUserStatus = transaction.use(
    async (
      session: ClientSession,
      targetUserId: string,
      status: "active" | "suspended" | "deleted",
      reason?: string,
    ) => {
      if (!targetUserId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const user = await User.findById(targetUserId).session(session);

      if (!user) {
        throw new NotFoundException(
          "User not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.AUTH_USER_NOT_FOUND,
        );
      }

      user.status = status;
      // Cleared on reactivation, set (or left blank) on suspend/delete.
      user.statusReason = status === "active" ? "" : (reason ?? "");

      if (status !== "active") {
        user.refreshToken = "";
        user.emailToken = "";
        user.otp = "";
        user.refreshTokenExpiry = new Date(Date.now() - 1000);
        user.emailTokenExpiry = new Date(Date.now() - 1000);
        user.otpExpiry = new Date(Date.now() - 1000);
      }

      await user.save({ session });

      if (user.userType === "vendor") {
        const vendor = await Vendor.findOne({ userId: user._id }).session(session);

        if (!vendor) {
          throw new NotFoundException(
            "Vendor not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        await Vendor.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              approvalStatus:
                status === "active" && vendor.approvalStatus === "suspended"
                  ? "approved"
                  : status === "active"
                    ? vendor.approvalStatus
                    : "suspended",
            },
          },
          { session },
        );
      }

      return { user: user.omitPassword() };
    },
  );
}
