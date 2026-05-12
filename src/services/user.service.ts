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

  getAllCustomers = async () => {
    const customers = await Customer.find()
      .populate("userId", "-passwordHash")
      .sort({ createdAt: -1 })
      .limit(50);

    return customers;
  };

  getAllVendors = async () => {
    const vendors = await Vendor.find()
      .populate("userId", "-passwordHash")
      .populate("addressId")
      .sort({ createdAt: -1 })
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

  getAdminAnalytics = async () => {
    const [
      totalCustomers,
      totalOrders,
      revenueAggregation,
      vendorStatusAggregation,
    ] = await Promise.all([
      User.countDocuments({
        userType: "customer",
        status: { $ne: "deleted" },
      }),
      Order.countDocuments(),
      Order.aggregate<{ _id: null; totalRevenue: number }>([
        {
          $match: {
            paymentStatus: "succeeded",
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
          },
        },
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

    return {
      totalCustomers,
      totalOrders,
      totalRevenue: revenueAggregation[0]?.totalRevenue ?? 0,
      vendors: vendorBreakdown,
    };
  };

  getAdminOrderAnalytics = async () => {
    const [statusBreakdown, paymentStatusBreakdown] = await Promise.all([
      Order.aggregate<{ _id: string; count: number }>([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        {
          $group: {
            _id: "$paymentStatus",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      orderCategories: statusBreakdown.map((entry) => ({
        category: entry._id,
        count: entry.count,
      })),
      paymentStatusBreakdown: paymentStatusBreakdown.map((entry) => ({
        status: entry._id,
        count: entry.count,
      })),
    };
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
