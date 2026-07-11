/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import Vendor from "../models/vendor.model.js";
import VendorPayoutAllocation from "../models/vendorPayoutAllocation.model.js";
import VendorPayoutRequest from "../models/vendorPayoutRequest.model.js";
import { transaction } from "../util/transaction.util.js";

type MarkPaidAllocationInput = {
  paymentId: string;
  amount: number;
};
type AdminPayoutStatus = "requested" | "processing" | "approved" | "rejected";

export class VendorWalletService {
  private getVendorByUserId = async (userId: string, session?: ClientSession) => {
    const query = Vendor.findOne({ userId });
    if (session) {
      query.session(session);
    }

    const vendor = await query;

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return vendor;
  };

  private assertPositiveAmount = (value: number, fieldName: string) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(
        `${fieldName} must be greater than 0`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  syncPaymentSettlementFromOrder = async (
    session: ClientSession,
    paymentId: string,
  ) => {
    const payment = await Payment.findById(paymentId).session(session);

    if (!payment) {
      throw new NotFoundException(
        "Payment not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const order = await Order.findById(payment.orderId).session(session);

    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const vendorGrossAmount = Math.max(order.totalAmount, 0);
    const vendorPlatformFeeAmount = Math.max(order.serviceCharge, 0);
    const vendorNetAmount = Math.max(vendorGrossAmount - vendorPlatformFeeAmount, 0);

    payment.vendorId = order.vendorId;
    payment.vendorGrossAmount = vendorGrossAmount;
    payment.vendorPlatformFeeAmount = vendorPlatformFeeAmount;
    payment.vendorNetAmount = vendorNetAmount;

    const isSucceeded = payment.status === "succeeded";
    if (!isSucceeded) {
      payment.settlementStatus = payment.vendorSettledAmount > 0 ? "reversed" : "ineligible";
      payment.settlementEligibleAt = undefined;
    } else if (payment.vendorSettledAmount <= 0) {
      payment.settlementStatus = "unsettled";
      payment.settlementEligibleAt = payment.paidAt ?? new Date();
    } else if (payment.vendorSettledAmount < payment.vendorNetAmount) {
      payment.settlementStatus = "partially_paid";
      payment.settlementEligibleAt = payment.paidAt ?? new Date();
    } else {
      payment.settlementStatus = "paid";
      payment.settlementEligibleAt = payment.paidAt ?? new Date();
    }

    await payment.save({ session });

    return payment;
  };

  getVendorWalletSummary = async (vendorUserId: string) => {
    const vendor = await this.getVendorByUserId(vendorUserId);

    const [summary] = await Payment.aggregate<{
      _id: null;
      currency: string;
      totalNet: number;
      totalSettled: number;
      pending: number;
      orderCount: number;
    }>([
      {
        $match: {
          vendorId: vendor._id,
          status: "succeeded",
        },
      },
      {
        $group: {
          _id: null,
          currency: { $first: "$currency" },
          totalNet: { $sum: "$vendorNetAmount" },
          totalSettled: { $sum: "$vendorSettledAmount" },
          pending: {
            $sum: {
              $max: [{ $subtract: ["$vendorNetAmount", "$vendorSettledAmount"] }, 0],
            },
          },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    return {
      wallet: {
        currency: summary?.currency ?? "NGN",
        lifetimeEarnings: summary?.totalNet ?? 0,
        totalPaidOut: summary?.totalSettled ?? 0,
        availableToPayout: summary?.pending ?? 0,
        paidOrdersCount: summary?.orderCount ?? 0,
      },
    };
  };

  getVendorTransactions = async (
    vendorUserId: string,
    options: { page?: number; limit?: number; settlementStatus?: string },
  ) => {
    const vendor = await this.getVendorByUserId(vendorUserId);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));

    const filter: Record<string, unknown> = {
      vendorId: vendor._id,
      status: "succeeded",
    };

    if (options.settlementStatus) {
      filter.settlementStatus = options.settlementStatus;
    }

    const [transactions, total] = await Promise.all([
      Payment.find(filter)
        .sort({ paidAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("orderId", "status totalAmount paymentStatus paidAt")
        .select(
          "orderId reference currency amount paidAt vendorGrossAmount vendorPlatformFeeAmount vendorNetAmount vendorSettledAmount settlementStatus settlementEligibleAt",
        ),
      Payment.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
      },
    };
  };

  requestVendorPayout = async (
    vendorUserId: string,
    input: {
      amount: number;
      note?: string;
      bankName?: string;
      accountName?: string;
      accountNumber?: string;
    },
  ) => {
    this.assertPositiveAmount(input.amount, "Amount");

    const vendor = await this.getVendorByUserId(vendorUserId);
    const summary = await this.getVendorWalletSummary(vendorUserId);

    if (input.amount > summary.wallet.availableToPayout) {
      throw new BadRequestException(
        "Requested amount exceeds available payout balance",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const openRequest = await VendorPayoutRequest.findOne({
      vendorId: vendor._id,
      status: { $in: ["requested", "processing", "approved"] },
      paymentStatus: "unpaid",
    });

    if (openRequest) {
      throw new BadRequestException(
        "A payout request is already in progress",
        HttpStatus.CONFLICT,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const payoutRequest = await VendorPayoutRequest.create({
      vendorId: vendor._id,
      requestedAmount: input.amount,
      approvedAmount: 0,
      currency: summary.wallet.currency,
      status: "requested",
      paymentStatus: "unpaid",
      note: input.note,
      bankDetailsSnapshot: {
        bankName: input.bankName,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
      },
    });

    return { payoutRequest };
  };

  getVendorPayoutRequests = async (vendorUserId: string) => {
    const vendor = await this.getVendorByUserId(vendorUserId);

    const payoutRequests = await VendorPayoutRequest.find({ vendorId: vendor._id }).sort({
      createdAt: -1,
    });

    return { payoutRequests };
  };

  getAdminPayoutRequests = async (status?: string) => {
    const filter: Record<string, unknown> = {};

    if (status) {
      filter.status = status;
    }

    const payoutRequests = await VendorPayoutRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate("vendorId", "businessName userId");

    return { payoutRequests };
  };

  getAdminPayoutRequestById = async (requestId: string) => {
    const payoutRequest = await VendorPayoutRequest.findById(requestId).populate(
      "vendorId",
      "businessName userId",
    );

    if (!payoutRequest) {
      throw new NotFoundException(
        "Payout request not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const allocations = await VendorPayoutAllocation.find({
      payoutRequestId: payoutRequest._id,
    })
      .sort({ createdAt: 1 })
      .populate("paymentId", "reference vendorNetAmount vendorSettledAmount")
      .populate("orderId", "_id totalAmount status paymentStatus");

    return { payoutRequest, allocations };
  };

  updateAdminPayoutRequest = async (
    adminUserId: string,
    requestId: string,
    payload: {
      status?: AdminPayoutStatus;
      // Alias accepted alongside `status` for the admin dashboard's
      // financialSlice.ts contract, which uses `action` instead — mapped to
      // `status` below without altering any of the transition/validation logic.
      action?: "approve" | "reject" | "process";
      paymentStatus?: "paid" | "unpaid";
      approvedAmount?: number;
      payoutReference?: string;
      note?: string;
      rejectionReason?: string;
      allocations?: MarkPaidAllocationInput[];
    },
  ) => {
    if (!payload.status && payload.action) {
      const actionToStatus: Record<string, AdminPayoutStatus> = {
        approve: "approved",
        reject: "rejected",
        process: "processing",
      };
      payload = { ...payload, status: actionToStatus[payload.action] };
    }

    const result = await transaction.use(
      async (session: ClientSession, currentAdminUserId: string, currentRequestId: string) => {
        const payoutRequest = await VendorPayoutRequest.findById(currentRequestId).session(
          session,
        );

        if (!payoutRequest) {
          throw new NotFoundException(
            "Payout request not found",
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        if (payload.status) {
          const allowedTransitions: Record<AdminPayoutStatus, AdminPayoutStatus[]> = {
            requested: ["processing", "approved", "rejected"],
            processing: ["approved", "rejected"],
            approved: ["rejected"],
            rejected: [],
          };

          const currentStatus = payoutRequest.status as AdminPayoutStatus;
          if (
            payload.status !== currentStatus &&
            !allowedTransitions[currentStatus]?.includes(payload.status)
          ) {
            throw new BadRequestException(
              "Invalid payout status transition",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          payoutRequest.status = payload.status;
          payoutRequest.processedBy = new mongoose.Types.ObjectId(currentAdminUserId);
        }

        if (payload.approvedAmount !== undefined) {
          this.assertPositiveAmount(payload.approvedAmount, "Approved amount");
          if (payload.approvedAmount > payoutRequest.requestedAmount) {
            throw new BadRequestException(
              "Approved amount cannot exceed requested amount",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }
          payoutRequest.approvedAmount = payload.approvedAmount;
        }

        if (payoutRequest.status === "approved" && payoutRequest.approvedBy == null) {
          payoutRequest.approvedBy = new mongoose.Types.ObjectId(currentAdminUserId);
          payoutRequest.approvedAt = new Date();
          if (payoutRequest.approvedAmount <= 0) {
            payoutRequest.approvedAmount = payoutRequest.requestedAmount;
          }
        }

        if (payload.status === "rejected") {
          if (!payload.rejectionReason?.trim()) {
            throw new BadRequestException(
              "Rejection reason is required when rejecting",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }
          payoutRequest.rejectionReason = payload.rejectionReason.trim();
        }

        if (payload.note) {
          payoutRequest.note = payload.note;
        }

        if (payload.paymentStatus === "paid") {
          if (payoutRequest.paymentStatus === "paid") {
            throw new BadRequestException(
              "Payout request is already marked as paid",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          if (payoutRequest.status !== "approved") {
            throw new BadRequestException(
              "Only approved payout requests can be marked as paid",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          if (!payload.payoutReference?.trim()) {
            throw new BadRequestException(
              "Payout reference is required",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          if (!Array.isArray(payload.allocations) || payload.allocations.length === 0) {
            throw new BadRequestException(
              "At least one payout allocation is required",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          const existingReference = await VendorPayoutRequest.findOne({
            payoutReference: payload.payoutReference,
            _id: { $ne: payoutRequest._id },
          }).session(session);

          if (existingReference) {
            throw new BadRequestException(
              "Payout reference already exists",
              HttpStatus.CONFLICT,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          let allocatedTotal = 0;
          const seenPaymentIds = new Set<string>();
          const allocationDocs: {
            payoutRequestId: typeof payoutRequest._id;
            vendorId: typeof payoutRequest.vendorId;
            paymentId: mongoose.Types.ObjectId;
            orderId: mongoose.Types.ObjectId;
            allocatedAmount: number;
            currency: string;
          }[] = [];

          for (const allocation of payload.allocations) {
            this.assertPositiveAmount(allocation.amount, "Allocation amount");
            if (seenPaymentIds.has(allocation.paymentId)) {
              throw new BadRequestException(
                "Duplicate payment allocation detected",
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
              );
            }
            seenPaymentIds.add(allocation.paymentId);

            const payment = await Payment.findById(allocation.paymentId).session(session);
            if (!payment) {
              throw new NotFoundException(
                "Payment not found in allocation",
                HttpStatus.NOT_FOUND,
                ErrorCode.RESOURCE_NOT_FOUND,
              );
            }

            if (payment.vendorId.toString() !== payoutRequest.vendorId.toString()) {
              throw new BadRequestException(
                "Allocation contains payment from a different vendor",
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
              );
            }

            if (payment.status !== "succeeded") {
              throw new BadRequestException(
                "Only succeeded payments can be allocated",
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
              );
            }

            const remaining = Math.max(payment.vendorNetAmount - payment.vendorSettledAmount, 0);
            if (allocation.amount > remaining) {
              throw new BadRequestException(
                "Allocation exceeds payment unsettled amount",
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
              );
            }

            payment.vendorSettledAmount += allocation.amount;
            if (payment.vendorSettledAmount <= 0) {
              payment.settlementStatus = "unsettled";
            } else if (payment.vendorSettledAmount < payment.vendorNetAmount) {
              payment.settlementStatus = "partially_paid";
            } else {
              payment.settlementStatus = "paid";
            }
            await payment.save({ session });

            allocationDocs.push({
              payoutRequestId: payoutRequest._id,
              vendorId: payoutRequest.vendorId,
              paymentId: payment._id as mongoose.Types.ObjectId,
              orderId: payment.orderId as mongoose.Types.ObjectId,
              allocatedAmount: allocation.amount,
              currency: payment.currency,
            });
            allocatedTotal += allocation.amount;
          }

          const expectedAmount =
            payoutRequest.approvedAmount > 0
              ? payoutRequest.approvedAmount
              : payoutRequest.requestedAmount;
          if (Math.abs(allocatedTotal - expectedAmount) > 0.000001) {
            throw new BadRequestException(
              "Allocated total must match approved/requested payout amount",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          await VendorPayoutAllocation.insertMany(allocationDocs, { session });

          payoutRequest.paymentStatus = "paid";
          payoutRequest.paidAt = new Date();
          payoutRequest.processedBy = new mongoose.Types.ObjectId(currentAdminUserId);
          payoutRequest.payoutReference = payload.payoutReference.trim();
          if (payload.note) {
            payoutRequest.note = payload.note;
          }
        } else if (payload.paymentStatus === "unpaid") {
          if (payoutRequest.paymentStatus === "paid") {
            throw new BadRequestException(
              "Cannot set paymentStatus back to unpaid",
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }
          payoutRequest.paymentStatus = "unpaid";
        }

        await payoutRequest.save({ session });
        return payoutRequest;
      },
    )(adminUserId, requestId);

    return { payoutRequest: result };
  };
}
