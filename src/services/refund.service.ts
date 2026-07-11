/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import { transaction } from "../util/transaction.util.js";

export class RefundService {
  createRefundRequest = async (
    requesterId: string,
    requesterType: string,
    orderId: string,
    body: { amount?: number; reason: string },
  ) => {
    const order = await Order.findById(orderId);

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    // A customer may only request a refund on their own order; an admin can
    // request one on a customer's behalf.
    if (requesterType !== "admin" && order.customerId.toString() !== requesterId) {
      throw new UnauthorizedExceptionError(
        "You can only request a refund for your own order",
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
      );
    }

    if (order.paymentStatus !== "succeeded") {
      throw new BadRequestException(
        "Only orders with a succeeded payment can be refunded",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const existingPending = await RefundRequest.findOne({
      orderId: order._id,
      status: "pending",
    });

    if (existingPending) {
      throw new BadRequestException(
        "A refund request is already pending for this order",
        HttpStatus.CONFLICT,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const amount = body.amount ?? order.totalAmount;

    if (amount <= 0 || amount > order.totalAmount) {
      throw new BadRequestException(
        "Refund amount must be greater than 0 and cannot exceed the order total",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const refundRequest = await RefundRequest.create({
      orderId: order._id,
      customerId: order.customerId,
      vendorId: order.vendorId,
      amount,
      reason: body.reason,
    });

    return { refundRequest };
  };

  getAdminRefundRequests = async (status?: string) => {
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }

    const refundRequests = await RefundRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("orderId", "totalAmount status paymentStatus createdAt")
      .populate("customerId", "firstName lastName email")
      .populate("vendorId", "businessName");

    return { refundRequests };
  };

  getAdminRefundRequestById = async (refundRequestId: string) => {
    const refundRequest = await RefundRequest.findById(refundRequestId)
      .populate("orderId")
      .populate("customerId", "firstName lastName email")
      .populate("vendorId", "businessName")
      .populate("decidedBy", "firstName lastName email");

    if (!refundRequest) {
      throw new NotFoundException(
        "Refund request not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { refundRequest };
  };

  decideRefundRequest = transaction.use(
    async (
      session: ClientSession,
      adminUserId: string,
      refundRequestId: string,
      decision: "approve" | "reject",
      adminNotes?: string,
    ) => {
      const refundRequest = await RefundRequest.findById(
        refundRequestId,
      ).session(session);

      if (!refundRequest) {
        throw new NotFoundException(
          "Refund request not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      if (refundRequest.status !== "pending") {
        throw new BadRequestException(
          "This refund request has already been decided",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      refundRequest.status = decision === "approve" ? "approved" : "rejected";
      refundRequest.adminNotes = adminNotes;
      refundRequest.decidedBy = new mongoose.Types.ObjectId(adminUserId);
      refundRequest.decidedAt = new Date();
      await refundRequest.save({ session });

      if (decision === "approve") {
        // Marks our own records as refunded only — this does NOT call
        // Paystack's refund API, so no real money movement is triggered.
        // Actual payout back to the customer still requires a manual
        // Paystack dashboard refund (or a future API integration).
        await Order.findByIdAndUpdate(
          refundRequest.orderId,
          { $set: { paymentStatus: "refunded" } },
          { session },
        );
        await Payment.findOneAndUpdate(
          { orderId: refundRequest.orderId },
          { $set: { status: "refunded" } },
          { session },
        );
      }

      return { refundRequest };
    },
  );
}
