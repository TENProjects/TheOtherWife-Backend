/** @format */

import mongoose from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import VendorPayoutRequest from "../models/vendorPayoutRequest.model.js";
import FinancialSettings from "../models/financialSettings.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { PaymentLedgerService } from "./payment-ledger.service.js";
import { financeAggregationService } from "./finance-aggregation.service.js";
import {
  PLATFORM_FEE_PERCENT,
  platformFeeEarned,
  platformFeeEarnedExpr,
  PROMO_COST_SHARE,
  refundAbsorbed as computeRefundAbsorbed,
  refundedVatShare,
  roundNaira,
} from "../util/finance-definitions.util.js";
import { UNPAID_CANCELLATION_REASON } from "../util/order-visibility.util.js";

export class FinancialsService {
  private paymentLedgerService = new PaymentLedgerService();

  // Full, ordered audit trail for one payment — every recorded state
  // transition and money movement, oldest first.
  getPaymentLedger = async (paymentId: string) => {
    if (!mongoose.isValidObjectId(paymentId)) {
      throw new BadRequestException(
        "Invalid payment ID",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new NotFoundException(
        "Payment not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    const entries = await this.paymentLedgerService.getEntriesForPayment(paymentId);
    return { payment, entries };
  };

  // Walks the entire ledger and recomputes every hash to confirm the chain
  // hasn't been altered — see PaymentLedgerService.verifyChainIntegrity for
  // what this actually checks, including the trustedCheckpoint parameter's
  // role in catching a full database-level regeneration.
  verifyLedgerIntegrity = async (trustedCheckpoint?: {
    sequenceNumber: number;
    entryHash: string;
  }) => {
    return this.paymentLedgerService.verifyChainIntegrity(trustedCheckpoint);
  };

  // On-demand version of the scheduled cron checkpoint — lets an admin
  // capture an external record right now instead of waiting for the next
  // scheduled run.
  emitLedgerCheckpoint = async () => {
    return this.paymentLedgerService.emitCheckpoint();
  };

  private percentChange = (current: number, previous: number): number => {
    if (previous === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - previous) / previous) * 100);
  };

  private getOrCreateSettings = async () => {
    let settings = await FinancialSettings.findOne();
    if (!settings) {
      settings = await FinancialSettings.create({});
    }
    return settings;
  };

  // Commission is TOW's platform fee (20% of the meal subtotal) plus the
  // service charge; net profit takes off Paystack fees, refunds absorbed and
  // promo costs. VAT is payable, never revenue. One definition for every
  // finance figure — see FinanceAggregationService.
  getSummary = async () => {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [allTime, thisMonth, lastMonth, pendingWithdrawalsAgg] =
      await Promise.all([
        financeAggregationService.aggregate(),
        financeAggregationService.aggregate({ $gte: startOfThisMonth }),
        financeAggregationService.aggregate({
          $gte: startOfLastMonth,
          $lt: startOfThisMonth,
        }),
        VendorPayoutRequest.aggregate<{
          _id: null;
          count: number;
          amount: number;
        }>([
          { $match: { status: { $in: ["requested", "processing"] } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              amount: { $sum: "$requestedAmount" },
            },
          },
        ]),
      ]);

    const pendingWithdrawals = pendingWithdrawalsAgg[0] ?? {
      count: 0,
      amount: 0,
    };

    return {
      totalRevenue: allTime.revenue,
      totalRevenueChange: this.percentChange(thisMonth.revenue, lastMonth.revenue),
      totalCommission: allTime.commission,
      // The platform fee actually charged at checkout (the editable
      // commission setting does not change it).
      commissionRatePercent: PLATFORM_FEE_PERCENT,
      commissionBreakdown: {
        platformFees: allTime.platformFees,
        serviceCharges: allTime.serviceCharges,
      },
      // Owed to the government — reported, never counted as profit.
      vatCollected: allTime.vatCollected,
      pendingWithdrawals: {
        count: pendingWithdrawals.count,
        amount: pendingWithdrawals.amount,
      },
      netProfit: allTime.netProfit,
      netProfitChange: this.percentChange(thisMonth.netProfit, lastMonth.netProfit),
    };
  };

  getAnalytics = async () => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [byMonth, commissionByCategoryAgg] = await Promise.all([
      financeAggregationService.aggregateByMonth({ $gte: twelveMonthsAgo }),
      // Apportions each order's commission (platform fee + service charge)
      // across its line items by revenue share, then groups by the item's
      // meal category — both are captured per order, not per item, so this
      // is a proportional allocation rather than a directly stored figure.
      Payment.aggregate<{ _id: string; commission: number }>([
        { $match: { context: "order", status: { $in: ["succeeded", "refunded"] } } },
        {
          $lookup: {
            from: "orders",
            localField: "orderId",
            foreignField: "_id",
            as: "order",
          },
        },
        { $unwind: "$order" },
        // A payment that arrived after its checkout expired earned nothing.
        {
          $match: {
            $nor: [
              {
                "order.status": "cancelled",
                "order.cancellationReason": UNPAID_CANCELLATION_REASON,
              },
            ],
          },
        },
        {
          $project: {
            subtotal: "$order.subtotal",
            items: "$order.items",
            commission: {
              $add: [platformFeeEarnedExpr(), { $ifNull: ["$order.serviceCharge", 0] }],
            },
          },
        },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "meals",
            localField: "items.mealId",
            foreignField: "_id",
            as: "mealInfo",
          },
        },
        { $unwind: { path: "$mealInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            categoryName: { $ifNull: ["$mealInfo.categoryName", "Uncategorized"] },
            commissionShare: {
              $cond: [
                { $gt: ["$subtotal", 0] },
                {
                  $multiply: [
                    "$commission",
                    { $divide: ["$items.lineTotal", "$subtotal"] },
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: "$categoryName",
            commission: { $sum: "$commissionShare" },
          },
        },
        { $sort: { commission: -1 } },
        { $limit: 10 },
      ]),
    ]);

    // Every one of the 12 months, so the trend is a continuous line even
    // when a month had no activity.
    const revenueProfitTrend: { month: string; revenue: number; profit: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const month = byMonth.get(monthKey);
      revenueProfitTrend.push({
        month: monthKey,
        revenue: month?.revenue ?? 0,
        profit: month?.netProfit ?? 0,
      });
    }

    return {
      revenueProfitTrend,
      commissionByCategory: commissionByCategoryAgg.map((entry) => ({
        category: entry._id,
        commission: Math.round(entry.commission),
      })),
    };
  };

  // Never returns the raw secretKey to the client — only whether one is on
  // file — so a stored credential can't leak through a GET response.
  getPaymentGateways = async () => {
    const settings = await this.getOrCreateSettings();
    return settings.paymentGateways.map((gateway) => ({
      key: gateway.key,
      name: gateway.name,
      transactionFeePercent: gateway.transactionFeePercent,
      isActive: gateway.isActive,
      publicKey: gateway.publicKey ?? null,
      hasSecretKey: Boolean(gateway.secretKey),
    }));
  };

  updatePaymentGateway = async (
    key: string,
    updates: {
      isActive?: boolean;
      transactionFeePercent?: number;
      publicKey?: string;
      secretKey?: string;
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();
    const gateway = settings.paymentGateways.find((g) => g.key === key);

    if (!gateway) {
      throw new NotFoundException(
        `Unknown payment gateway "${key}"`,
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (updates.isActive !== undefined) {
      gateway.isActive = updates.isActive;
    }
    if (updates.transactionFeePercent !== undefined) {
      gateway.transactionFeePercent = updates.transactionFeePercent;
    }
    if (updates.publicKey !== undefined) {
      gateway.publicKey = updates.publicKey;
    }
    if (updates.secretKey !== undefined) {
      gateway.secretKey = updates.secretKey;
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      key: gateway.key,
      name: gateway.name,
      transactionFeePercent: gateway.transactionFeePercent,
      isActive: gateway.isActive,
      publicKey: gateway.publicKey ?? null,
      hasSecretKey: Boolean(gateway.secretKey),
    };
  };

  // Live-validates a secret key against the provider's own API — does not
  // read or write the stored key, so it works against whatever the admin has
  // currently typed into the form, saved or not.
  testGatewayConnection = async (
    key: string,
    secretKey: string,
  ): Promise<{ success: boolean; message: string }> => {
    if (key === "paystack") {
      const response = await fetch("https://api.paystack.co/bank?perPage=1", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (response.ok) {
        return { success: true, message: "Paystack connection successful." };
      }
      return {
        success: false,
        message:
          response.status === 401
            ? "Invalid Paystack secret key."
            : `Paystack responded with status ${response.status}.`,
      };
    }

    if (key === "flutterwave") {
      const response = await fetch("https://api.flutterwave.com/v3/balances", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (response.ok) {
        return { success: true, message: "Flutterwave connection successful." };
      }
      return {
        success: false,
        message:
          response.status === 401
            ? "Invalid Flutterwave secret key."
            : `Flutterwave responded with status ${response.status}.`,
      };
    }

    throw new BadRequestException(
      `Test Connect is not supported for gateway "${key}"`,
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    );
  };

  getCommissionConfig = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      commissionType: settings.commissionType,
      commissionRate: settings.commissionRate,
    };
  };

  updateCommissionConfig = async (
    payload: { commissionType: "percentage" | "flat"; commissionRate: number },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();
    settings.commissionType = payload.commissionType;
    settings.commissionRate = payload.commissionRate;
    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      commissionType: settings.commissionType,
      commissionRate: settings.commissionRate,
    };
  };

  getTaxSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      defaultRate: settings.taxDefaultRate,
      categories: settings.taxCategories,
    };
  };

  updateTaxSettings = async (
    payload: {
      defaultRate: number;
      categories?: { name: string; rate: number }[];
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();
    settings.taxDefaultRate = payload.defaultRate;
    if (payload.categories) {
      settings.taxCategories = payload.categories as typeof settings.taxCategories;
    }
    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      defaultRate: settings.taxDefaultRate,
      categories: settings.taxCategories,
    };
  };

  getVatSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      vatEnabled: settings.vatEnabled,
      vatRate: 7.5,
      vatToggledAt: settings.vatToggledAt ?? null,
      vatToggledBy: settings.vatToggledBy ?? null,
    };
  };

  // Requires explicit re-confirmation (payload.confirm === true, enforced by
  // updateVatSettingsSchema) — mirrors the spec's "second confirmation"
  // requirement for enabling VAT. Only stamps the audit trail when the value
  // actually changes, so vatToggledAt/vatToggledBy reflect the last real flip.
  updateVatSettings = async (
    payload: { enabled: boolean },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();

    if (settings.vatEnabled !== payload.enabled) {
      settings.vatEnabled = payload.enabled;
      settings.vatToggledAt = new Date();
      settings.vatToggledBy = new mongoose.Types.ObjectId(adminUserId);
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      vatEnabled: settings.vatEnabled,
      vatRate: 7.5,
      vatToggledAt: settings.vatToggledAt ?? null,
      vatToggledBy: settings.vatToggledBy ?? null,
    };
  };

  getSystemSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      refundAutoApprovalThreshold: settings.refundAutoApprovalThreshold,
      orderDelayThresholdMinutes: settings.orderDelayThresholdMinutes,
      minimumWithdrawalAmount: settings.minimumWithdrawalAmount,
    };
  };

  updateSystemSettings = async (
    payload: {
      refundAutoApprovalThreshold?: number;
      orderDelayThresholdMinutes?: number;
      minimumWithdrawalAmount?: number;
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();

    if (payload.refundAutoApprovalThreshold !== undefined) {
      settings.refundAutoApprovalThreshold = payload.refundAutoApprovalThreshold;
    }
    if (payload.orderDelayThresholdMinutes !== undefined) {
      settings.orderDelayThresholdMinutes = payload.orderDelayThresholdMinutes;
    }
    if (payload.minimumWithdrawalAmount !== undefined) {
      settings.minimumWithdrawalAmount = payload.minimumWithdrawalAmount;
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      refundAutoApprovalThreshold: settings.refundAutoApprovalThreshold,
      orderDelayThresholdMinutes: settings.orderDelayThresholdMinutes,
      minimumWithdrawalAmount: settings.minimumWithdrawalAmount,
    };
  };

  // Financial & Commission Spec v1.0, section 7.1 — full per-order profit
  // breakdown, on the same definition as every other finance figure: VAT is
  // payable (not profit) and a refund's cost is net of its VAT share and of
  // what was clawed back from the vendor.
  getOrderProfitBreakdown = async (orderId: string) => {
    if (!mongoose.isValidObjectId(orderId)) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const [payment, approvedRefunds] = await Promise.all([
      Payment.findOne({ orderId: order._id, context: "order" }),
      // Every customer-facing refund (vendor rejection, pre-preparation
      // cancellation, admin-mediated dispute) is an approved RefundRequest.
      RefundRequest.find({ orderId: order._id, status: "approved" }).select("amount"),
    ]);

    const paid = payment?.status === "succeeded" || payment?.status === "refunded";
    // A payment that arrived after the checkout expired never became an
    // order: no commission, and its refund simply returns the money.
    const lateAfterExpiry =
      order.status === "cancelled" &&
      order.cancellationReason === UNPAID_CANCELLATION_REASON;
    const counts = paid && !lateAfterExpiry;

    const refundIssued = counts
      ? approvedRefunds.reduce((sum, refund) => sum + (refund.amount ?? 0), 0)
      : 0;
    const orderTaxAmount = order.taxAmount ?? 0;
    const orderTotalAmount = order.totalAmount ?? 0;
    const vatRefunded = refundedVatShare({
      refundAmount: refundIssued,
      orderTaxAmount,
      orderTotalAmount,
    });
    const clawbackRecovered = Math.min(
      payment?.vendorClawbackAmount ?? 0,
      Math.max(refundIssued - vatRefunded, 0),
    );
    const refundAbsorbed = computeRefundAbsorbed({
      refundAmount: refundIssued,
      orderTaxAmount,
      orderTotalAmount,
      clawbackRecovered,
    });

    const towCommission = counts && payment ? platformFeeEarned(payment, order) : 0;
    const processingFee = counts ? order.serviceCharge : 0;
    const promoDiscountCost = counts
      ? Math.round((order.discountAmount ?? 0) * PROMO_COST_SHARE)
      : 0;
    const paystackFeeAmount = paid ? payment?.paystackFeeAmount ?? 0 : 0;

    const netProfit = roundNaira(
      towCommission + processingFee - paystackFeeAmount - refundAbsorbed - promoDiscountCost,
    );

    return {
      orderId: order._id.toString(),
      mealSubtotal: order.subtotal,
      processingFee: order.serviceCharge,
      vat: orderTaxAmount,
      customerTotal: order.totalAmount,
      paystackFee: paystackFeeAmount,
      homeChefPayout: payment?.vendorNetAmount ?? 0,
      towCommission,
      // TOW's gross earnings on the order: platform fee + service charge.
      totalCommission: roundNaira(towCommission + processingFee),
      refundIssued,
      clawbackRecovered,
      refundAbsorbed,
      promoDiscountCost,
      // Owed to the government, net of any refunded share — not profit.
      vatPayable: counts ? roundNaira(Math.max(orderTaxAmount - vatRefunded, 0)) : 0,
      lateAfterExpiry,
      towNetProfit: netProfit,
    };
  };

  // Section 7.2 — aggregated dashboard summary cards for a time range
  // (inclusive), on the shared definition. Existing fields are kept;
  // grossRevenue no longer includes VAT (now reported as payable).
  getNetProfitSummary = async (range?: { from?: Date; to?: Date }) => {
    if (range?.from && range?.to && range.from.getTime() > range.to.getTime()) {
      throw new BadRequestException(
        "`from` must be before `to`",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const dateRange: { $gte?: Date; $lte?: Date } = {};
    if (range?.from) dateRange.$gte = range.from;
    if (range?.to) dateRange.$lte = range.to;

    const totals = await financeAggregationService.aggregate(dateRange);

    return {
      totalGMV: totals.mealSubtotal,
      totalProcessingFees: totals.serviceCharges,
      totalVatCollected: totals.vatCollected,
      totalPaystackCosts: totals.paystackFees,
      totalCommissions: totals.platformFees,
      totalRefundsIssued: totals.refundsIssued,
      totalRefundsAbsorbed: totals.refundsAbsorbed,
      totalClawbackRecovered: totals.clawbackRecovered,
      totalPromoCosts: totals.promoCosts,
      grossRevenue: totals.commission,
      totalCosts: totals.totalCosts,
      netProfit: totals.netProfit,
    };
  };

}
