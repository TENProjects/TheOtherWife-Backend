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

export class FinancialsService {
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

  // Only Paystack has a real payment integration (see payment.service.ts /
  // Payment.provider), so it's the only gateway fee that represents an
  // actual processing cost. Used to derive net profit below.
  private getRealGatewayFeePercent = (
    paymentGateways: { key: string; transactionFeePercent: number }[],
  ): number =>
    paymentGateways.find((g) => g.key === "paystack")?.transactionFeePercent ?? 0;

  getSummary = async () => {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalsAgg,
      thisMonthAgg,
      lastMonthAgg,
      pendingWithdrawalsAgg,
      settings,
    ] = await Promise.all([
      Order.aggregate<{ _id: null; revenue: number; commission: number }>([
        { $match: { paymentStatus: "paid" } },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$totalAmount" },
            commission: { $sum: "$serviceCharge" },
          },
        },
      ]),
      Order.aggregate<{ _id: null; revenue: number; commission: number }>([
        {
          $match: {
            paymentStatus: "paid",
            createdAt: { $gte: startOfThisMonth },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$totalAmount" },
            commission: { $sum: "$serviceCharge" },
          },
        },
      ]),
      Order.aggregate<{ _id: null; revenue: number; commission: number }>([
        {
          $match: {
            paymentStatus: "paid",
            createdAt: { $gte: startOfLastMonth, $lt: startOfThisMonth },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$totalAmount" },
            commission: { $sum: "$serviceCharge" },
          },
        },
      ]),
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
      this.getOrCreateSettings(),
    ]);

    const gatewayFeePercent = this.getRealGatewayFeePercent(
      settings.paymentGateways,
    );

    const totals = totalsAgg[0] ?? { revenue: 0, commission: 0 };
    const thisMonth = thisMonthAgg[0] ?? { revenue: 0, commission: 0 };
    const lastMonth = lastMonthAgg[0] ?? { revenue: 0, commission: 0 };
    const pendingWithdrawals = pendingWithdrawalsAgg[0] ?? {
      count: 0,
      amount: 0,
    };

    // Net profit = commission revenue minus the real cost of processing that
    // revenue through the platform's actual payment gateway (Paystack).
    const netProfit =
      totals.commission - (totals.revenue * gatewayFeePercent) / 100;
    const netProfitThisMonth =
      thisMonth.commission - (thisMonth.revenue * gatewayFeePercent) / 100;
    const netProfitLastMonth =
      lastMonth.commission - (lastMonth.revenue * gatewayFeePercent) / 100;

    return {
      totalRevenue: totals.revenue,
      totalRevenueChange: this.percentChange(
        thisMonth.revenue,
        lastMonth.revenue,
      ),
      totalCommission: totals.commission,
      commissionRatePercent: settings.commissionRate,
      pendingWithdrawals: {
        count: pendingWithdrawals.count,
        amount: pendingWithdrawals.amount,
      },
      netProfit,
      netProfitChange: this.percentChange(
        netProfitThisMonth,
        netProfitLastMonth,
      ),
    };
  };

  getAnalytics = async () => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [revenueByMonth, commissionByCategoryAgg, settings] =
      await Promise.all([
        Order.aggregate<{
          _id: { year: number; month: number };
          revenue: number;
          commission: number;
        }>([
          {
            $match: {
              paymentStatus: "paid",
              createdAt: { $gte: twelveMonthsAgo },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              revenue: { $sum: "$totalAmount" },
              commission: { $sum: "$serviceCharge" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]),
        // Apportions each order's commission (serviceCharge) across its line
        // items by revenue share, then groups by the item's meal category —
        // serviceCharge is captured at the order level, not per item, so this
        // is a proportional allocation rather than a directly stored figure.
        Order.aggregate<{ _id: string; commission: number }>([
          { $match: { paymentStatus: "paid" } },
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
                      "$serviceCharge",
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
        this.getOrCreateSettings(),
      ]);

    const gatewayFeePercent = this.getRealGatewayFeePercent(
      settings.paymentGateways,
    );

    return {
      revenueProfitTrend: revenueByMonth.map((entry) => ({
        month: `${entry._id.year}-${String(entry._id.month).padStart(2, "0")}`,
        revenue: entry.revenue,
        profit: entry.commission - (entry.revenue * gatewayFeePercent) / 100,
      })),
      commissionByCategory: commissionByCategoryAgg.map((entry) => ({
        category: entry._id,
        commission: Math.round(entry.commission),
      })),
    };
  };

  getPaymentGateways = async () => {
    const settings = await this.getOrCreateSettings();
    return settings.paymentGateways;
  };

  updatePaymentGateway = async (
    key: string,
    updates: { isActive?: boolean; transactionFeePercent?: number },
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

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return gateway;
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
  // breakdown. Deliberately independent of getSummary/getAnalytics above
  // (which predate this spec and are left untouched) so nothing already
  // consuming those is affected.
  getOrderProfitBreakdown = async (orderId: string) => {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new NotFoundException(
        "Order not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const payment = await Payment.findOne({ orderId: order._id });

    // "Refund Absorbed" is Scenario B only (section 7.1) — Scenario A's
    // TOW-side cost is just the Paystack fee, already reflected below.
    const approvedRefund = await RefundRequest.findOne({
      orderId: order._id,
      status: "approved",
    });
    const refundAbsorbed = approvedRefund?.amount ?? 0;

    const promoDiscountCost = Math.round((order.discountAmount ?? 0) * 0.2);
    const towCommission = payment?.vendorPlatformFeeAmount ?? 0;
    const paystackFeeAmount = payment?.paystackFeeAmount ?? 0;

    const netProfit =
      towCommission +
      order.serviceCharge +
      (order.taxAmount ?? 0) -
      paystackFeeAmount -
      refundAbsorbed -
      promoDiscountCost;

    return {
      orderId: order._id.toString(),
      mealSubtotal: order.subtotal,
      processingFee: order.serviceCharge,
      vat: order.taxAmount ?? 0,
      customerTotal: order.totalAmount,
      paystackFee: paystackFeeAmount,
      homeChefPayout: payment?.vendorNetAmount ?? 0,
      towCommission,
      refundAbsorbed,
      promoDiscountCost,
      towNetProfit: netProfit,
    };
  };

  // Section 7.2 — aggregated dashboard summary cards for a time range.
  getNetProfitSummary = async (range?: { from?: Date; to?: Date }) => {
    if (range?.from && range?.to && range.from.getTime() > range.to.getTime()) {
      throw new BadRequestException(
        "`from` must be before `to`",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const createdAtMatch: Record<string, Date> = {};
    if (range?.from) createdAtMatch.$gte = range.from;
    if (range?.to) createdAtMatch.$lte = range.to;

    const orderMatch: Record<string, unknown> = { paymentStatus: "paid" };
    if (Object.keys(createdAtMatch).length > 0) {
      orderMatch.createdAt = createdAtMatch;
    }

    const [orderAgg] = await Order.aggregate<{
      _id: null;
      totalGMV: number;
      totalProcessingFees: number;
      totalVatCollected: number;
      totalPromoCosts: number;
    }>([
      { $match: orderMatch },
      {
        $group: {
          _id: null,
          totalGMV: { $sum: "$subtotal" },
          totalProcessingFees: { $sum: "$serviceCharge" },
          totalVatCollected: { $sum: { $ifNull: ["$taxAmount", 0] } },
          totalPromoCosts: {
            $sum: { $multiply: [{ $ifNull: ["$discountAmount", 0] }, 0.2] },
          },
        },
      },
    ]);

    const [paymentAgg] = await Payment.aggregate<{
      _id: null;
      totalPaystackCosts: number;
      totalCommissions: number;
    }>([
      { $match: { status: "succeeded", context: "order", ...(Object.keys(createdAtMatch).length > 0 ? { createdAt: createdAtMatch } : {}) } },
      {
        $group: {
          _id: null,
          totalPaystackCosts: { $sum: { $ifNull: ["$paystackFeeAmount", 0] } },
          totalCommissions: { $sum: { $ifNull: ["$vendorPlatformFeeAmount", 0] } },
        },
      },
    ]);

    const refundMatch: Record<string, unknown> = { status: "approved" };
    if (Object.keys(createdAtMatch).length > 0) {
      refundMatch.decidedAt = createdAtMatch;
    }
    const [refundAgg] = await RefundRequest.aggregate<{
      _id: null;
      totalRefundsIssued: number;
    }>([
      { $match: refundMatch },
      { $group: { _id: null, totalRefundsIssued: { $sum: "$amount" } } },
    ]);

    const totalGMV = orderAgg?.totalGMV ?? 0;
    const totalProcessingFees = orderAgg?.totalProcessingFees ?? 0;
    const totalVatCollected = orderAgg?.totalVatCollected ?? 0;
    const totalPromoCosts = Math.round(orderAgg?.totalPromoCosts ?? 0);
    const totalPaystackCosts = paymentAgg?.totalPaystackCosts ?? 0;
    const totalCommissions = paymentAgg?.totalCommissions ?? 0;
    const totalRefundsIssued = refundAgg?.totalRefundsIssued ?? 0;

    const grossRevenue = totalCommissions + totalProcessingFees + totalVatCollected;
    const totalCosts = totalPaystackCosts + totalRefundsIssued + totalPromoCosts;
    const netProfit = grossRevenue - totalCosts;

    return {
      totalGMV,
      totalProcessingFees,
      totalVatCollected,
      totalPaystackCosts,
      totalCommissions,
      totalRefundsIssued,
      totalPromoCosts,
      grossRevenue,
      totalCosts,
      netProfit,
    };
  };
}
