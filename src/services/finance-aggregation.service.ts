/** @format */

import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import {
  emptyFinanceComponents,
  FinanceComponents,
  platformFeeEarnedExpr,
  PROMO_COST_SHARE,
  refundAbsorbed,
  refundedVatShare,
  roundNaira,
  summarizeFinance,
} from "../util/finance-definitions.util.js";
import { UNPAID_CANCELLATION_REASON } from "../util/order-visibility.util.js";

// A date range on each figure's own date: when the money arrived for
// payments and revenue (paidAt, else createdAt), and when a refund was
// approved (decidedAt).
export type FinanceDateRange = { $gte?: Date; $lt?: Date; $lte?: Date };

type Bucket = FinanceComponents & { revenue: number; mealSubtotal: number };

export type TowFinanceTotals = ReturnType<typeof summarizeFinance> & {
  // Customer GMV: what customers paid for orders that stood (service charge
  // and VAT included), and the meal subtotal behind it.
  revenue: number;
  mealSubtotal: number;
};

const ALL = "all";

const emptyBucket = (): Bucket => ({
  ...emptyFinanceComponents(),
  revenue: 0,
  mealSubtotal: 0,
});

// Calendar month in UTC, matching Mongo's $dateToString default.
export const monthKeyOf = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

// A payment that only arrived after its checkout had expired: the order
// stayed cancelled and the money is refunded in full, so it never earns
// commission, VAT or revenue. Its Paystack fee is still a real cost.
const isLateAfterExpiry = (
  order: { status?: string; cancellationReason?: string | null } | null | undefined,
) =>
  order?.status === "cancelled" &&
  order?.cancellationReason === UNPAID_CANCELLATION_REASON;

/**
 * Every finance figure (Financials summary/analytics, the §7 net-profit
 * endpoints, the admin dashboard trend) comes from here, using the single
 * definition in util/finance-definitions.util.ts:
 *
 *   commission = 20% platform fee + service charge
 *   net profit = commission − Paystack fees − refunds absorbed − promo costs
 *
 * VAT is reported as payable, never as revenue or profit. Order payments
 * only: meal-plan batch payments are excluded, as before, so nothing is
 * counted twice.
 */
export class FinanceAggregationService {
  aggregate = async (range?: FinanceDateRange): Promise<TowFinanceTotals> => {
    const buckets = await this.collect(range, false);
    return this.finalize(buckets.get(ALL));
  };

  // Keyed "YYYY-MM"; months with no activity are absent.
  aggregateByMonth = async (
    range?: FinanceDateRange,
  ): Promise<Map<string, TowFinanceTotals>> => {
    const buckets = await this.collect(range, true);
    return new Map(
      [...buckets].map(([key, bucket]) => [key, this.finalize(bucket)]),
    );
  };

  private finalize = (bucket?: Bucket): TowFinanceTotals => {
    const b = bucket ?? emptyBucket();
    return {
      ...summarizeFinance(b),
      revenue: roundNaira(b.revenue),
      mealSubtotal: roundNaira(b.mealSubtotal),
    };
  };

  private collect = async (
    range: FinanceDateRange | undefined,
    byMonth: boolean,
  ): Promise<Map<string, Bucket>> => {
    const buckets = new Map<string, Bucket>();
    const bucketFor = (key: string) => {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = emptyBucket();
        buckets.set(key, bucket);
      }
      return bucket;
    };

    const rangeMatch =
      range && Object.keys(range).length > 0 ? [{ $match: { bucketDate: range } }] : [];
    const groupKey = byMonth
      ? { $dateToString: { format: "%Y-%m", date: "$bucketDate" } }
      : ALL;

    const [payments, revenue, refunds] = await Promise.all([
      Payment.aggregate<{
        _id: string;
        platformFees: number;
        serviceCharges: number;
        vatCollected: number;
        promoCosts: number;
        paystackFees: number;
      }>([
        { $match: { context: "order", status: { $in: ["succeeded", "refunded"] } } },
        { $addFields: { bucketDate: { $ifNull: ["$paidAt", "$createdAt"] } } },
        ...rangeMatch,
        {
          $lookup: {
            from: "orders",
            localField: "orderId",
            foreignField: "_id",
            as: "order",
          },
        },
        { $unwind: "$order" },
        {
          $addFields: {
            stood: {
              $not: [
                {
                  $and: [
                    { $eq: ["$order.status", "cancelled"] },
                    { $eq: ["$order.cancellationReason", UNPAID_CANCELLATION_REASON] },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: groupKey,
            platformFees: {
              $sum: { $cond: ["$stood", platformFeeEarnedExpr(), 0] },
            },
            serviceCharges: {
              $sum: { $cond: ["$stood", { $ifNull: ["$order.serviceCharge", 0] }, 0] },
            },
            vatCollected: {
              $sum: { $cond: ["$stood", { $ifNull: ["$order.taxAmount", 0] }, 0] },
            },
            promoCosts: {
              $sum: {
                $cond: [
                  "$stood",
                  { $multiply: [{ $ifNull: ["$order.discountAmount", 0] }, PROMO_COST_SHARE] },
                  0,
                ],
              },
            },
            paystackFees: { $sum: { $ifNull: ["$paystackFeeAmount", 0] } },
          },
        },
      ]),
      Order.aggregate<{ _id: string; revenue: number; mealSubtotal: number }>([
        {
          $match: {
            paymentStatus: "paid",
            cancellationReason: { $ne: UNPAID_CANCELLATION_REASON },
          },
        },
        { $addFields: { bucketDate: { $ifNull: ["$paidAt", "$createdAt"] } } },
        ...rangeMatch,
        {
          $group: {
            _id: groupKey,
            revenue: { $sum: "$totalAmount" },
            mealSubtotal: { $sum: "$subtotal" },
          },
        },
      ]),
      RefundRequest.find({
        status: "approved",
        ...(range && Object.keys(range).length > 0 ? { decidedAt: range } : {}),
      })
        .select("orderId amount decidedAt createdAt")
        .sort({ decidedAt: 1, createdAt: 1 })
        .lean(),
    ]);

    for (const entry of payments) {
      const bucket = bucketFor(entry._id);
      bucket.platformFees += entry.platformFees;
      bucket.serviceCharges += entry.serviceCharges;
      bucket.vatCollected += entry.vatCollected;
      bucket.promoCosts += entry.promoCosts;
      bucket.paystackFees += entry.paystackFees;
    }

    for (const entry of revenue) {
      const bucket = bucketFor(entry._id);
      bucket.revenue += entry.revenue;
      bucket.mealSubtotal += entry.mealSubtotal;
    }

    await this.applyRefunds(refunds, byMonth, bucketFor);

    return buckets;
  };

  // A refund costs TOW the refunded amount less its VAT share (that reduces
  // VAT payable instead) and less what was clawed back from the vendor. The
  // order's clawback is used up by its refunds in the order they were
  // approved.
  private applyRefunds = async (
    refunds: {
      orderId?: unknown;
      amount?: number;
      decidedAt?: Date;
      createdAt?: Date;
    }[],
    byMonth: boolean,
    bucketFor: (key: string) => Bucket,
  ) => {
    const orderIds = [
      ...new Set(
        refunds.map((refund) => refund.orderId?.toString()).filter(Boolean) as string[],
      ),
    ];
    if (orderIds.length === 0) return;

    const [orders, payments] = await Promise.all([
      Order.find({ _id: { $in: orderIds } })
        .select("taxAmount totalAmount status cancellationReason")
        .lean(),
      Payment.find({ orderId: { $in: orderIds }, context: "order" })
        .select("orderId vendorClawbackAmount")
        .lean(),
    ]);

    const orderById = new Map(orders.map((order) => [order._id.toString(), order]));
    const clawbackLeft = new Map<string, number>();
    for (const payment of payments) {
      const key = payment.orderId?.toString();
      if (!key) continue;
      clawbackLeft.set(key, (clawbackLeft.get(key) ?? 0) + (payment.vendorClawbackAmount ?? 0));
    }

    for (const refund of refunds) {
      const orderId = refund.orderId?.toString();
      const order = orderId ? orderById.get(orderId) : undefined;
      const amount = refund.amount ?? 0;

      // A late payment's refund just returns money that never became an
      // order (its commission was never counted either).
      if (!orderId || !order || isLateAfterExpiry(order) || amount <= 0) {
        continue;
      }

      const orderTaxAmount = order.taxAmount ?? 0;
      const orderTotalAmount = order.totalAmount ?? 0;
      const vatShare = refundedVatShare({
        refundAmount: amount,
        orderTaxAmount,
        orderTotalAmount,
      });
      const available = clawbackLeft.get(orderId) ?? 0;
      const clawbackUsed = Math.min(available, Math.max(amount - vatShare, 0));
      clawbackLeft.set(orderId, available - clawbackUsed);

      const date = refund.decidedAt ?? refund.createdAt;
      if (byMonth && !date) continue;
      const bucket = bucketFor(byMonth ? monthKeyOf(new Date(date as Date)) : ALL);
      bucket.refundsIssued += amount;
      bucket.vatRefunded += vatShare;
      bucket.clawbackRecovered += clawbackUsed;
      bucket.refundsAbsorbed += refundAbsorbed({
        refundAmount: amount,
        orderTaxAmount,
        orderTotalAmount,
        clawbackRecovered: clawbackUsed,
      });
    }
  };
}

export const financeAggregationService = new FinanceAggregationService();
