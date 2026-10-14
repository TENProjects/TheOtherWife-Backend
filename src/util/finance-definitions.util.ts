/** @format */

// One definition of TOW's money, used by every finance figure (Financials
// summary/analytics, the §7 net-profit endpoints and the admin dashboard
// trend) and consistent with the partner code's towEarnedOnOrder:
//
//   Commission (TOW gross earnings) = 20% platform fee + service charge
//   Net profit = commission − Paystack fees − refunds absorbed − promo costs
//
// VAT is owed to the government: it is reported separately as payable and is
// never revenue or profit.

// Financial & Commission Specification v1.0 — the vendor keeps 80% of the
// (discounted) meal subtotal; TOW's platform fee is the other 20%.
export const VENDOR_PAYOUT_RATE = 0.8;
export const PLATFORM_FEE_PERCENT = Math.round((1 - VENDOR_PAYOUT_RATE) * 100);

// The one place the vendor/TOW split of an order is computed (checkout,
// payment settlement sync, scripts, seed data). The vendor's 80% is rounded
// to the naira and TOW's 20% is the remainder, so the two always add up to
// the meal subtotal exactly.
export const vendorSplitOf = (effectiveSubtotal: number) => {
  const vendorGrossAmount = Math.max(effectiveSubtotal, 0);
  const vendorNetAmount = Math.max(Math.round(vendorGrossAmount * VENDOR_PAYOUT_RATE), 0);
  return {
    vendorGrossAmount,
    vendorNetAmount,
    vendorPlatformFeeAmount: vendorGrossAmount - vendorNetAmount,
  };
};

// Splits recorded before the 80/20 rule (by checkout at the time, or the old
// wallet backfill) stored TOW's cut — the service charge — as the "platform
// fee", with the vendor owed the rest of the order total. Those orders earned
// TOW the service charge only, so that field must not also be counted as a
// platform fee (it would count the service charge twice). An 80/20 split can
// never look like this: its gross is the meal subtotal, never the order total
// when a service charge applies.
export const isLegacyServiceChargeSplit = (
  payment: { vendorGrossAmount?: number | null; vendorPlatformFeeAmount?: number | null },
  order: { serviceCharge?: number | null; totalAmount?: number | null },
): boolean => {
  const serviceCharge = order.serviceCharge ?? 0;
  return (
    serviceCharge > 0 &&
    payment.vendorPlatformFeeAmount === serviceCharge &&
    payment.vendorGrossAmount === order.totalAmount
  );
};

// TOW's 20% platform fee actually earned on an order's payment.
export const platformFeeEarned = (
  payment: { vendorGrossAmount?: number | null; vendorPlatformFeeAmount?: number | null },
  order: { serviceCharge?: number | null; totalAmount?: number | null },
): number =>
  isLegacyServiceChargeSplit(payment, order)
    ? 0
    : Math.max(payment.vendorPlatformFeeAmount ?? 0, 0);

// The same rule as a Mongo expression, for aggregations over payments joined
// to their order (`paymentPath`/`orderPath` are field prefixes like "$order").
// Typed loosely on purpose: Mongo expressions are checked by MongoDB, and
// their deeply nested literal types make TypeScript's pipeline matching blow up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const platformFeeEarnedExpr = (paymentPath = "$", orderPath = "$order"): any => {
  const p = (field: string) => (paymentPath === "$" ? `$${field}` : `${paymentPath}.${field}`);
  const o = (field: string) => `${orderPath}.${field}`;
  return {
    $cond: [
      {
        $and: [
          { $gt: [{ $ifNull: [o("serviceCharge"), 0] }, 0] },
          { $eq: [p("vendorPlatformFeeAmount"), o("serviceCharge")] },
          { $eq: [p("vendorGrossAmount"), o("totalAmount")] },
        ],
      },
      0,
      { $max: [{ $ifNull: [p("vendorPlatformFeeAmount"), 0] }, 0] },
    ],
  };
};

// Spec §7.1 — TOW's share of a promo discount, booked as a cost.
export const PROMO_COST_SHARE = 0.2;

export const roundNaira = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export type RefundInput = {
  // Approved refund amount(s) for the order.
  refundAmount: number;
  // The order's VAT and total, to remove the VAT share from the refund (a
  // refunded VAT reduces VAT payable, not profit).
  orderTaxAmount: number;
  orderTotalAmount: number;
  // The vendor's share recovered by an automatic clawback (vendor rejection
  // or pre-preparation cancellation) — money TOW no longer owes the vendor.
  clawbackRecovered: number;
};

// What a refund actually costs TOW. For a pre-preparation cancellation (full
// refund + full clawback) this equals the order's commission, so the order
// nets to −Paystack fee — exactly what happened in reality.
export const refundAbsorbed = ({
  refundAmount,
  orderTaxAmount,
  orderTotalAmount,
  clawbackRecovered,
}: RefundInput): number => {
  if (refundAmount <= 0) return 0;
  const vatShare =
    orderTotalAmount > 0 ? (orderTaxAmount / orderTotalAmount) * refundAmount : 0;
  return roundNaira(Math.max(refundAmount - vatShare - clawbackRecovered, 0));
};

export const refundedVatShare = ({
  refundAmount,
  orderTaxAmount,
  orderTotalAmount,
}: Omit<RefundInput, "clawbackRecovered">): number =>
  orderTotalAmount > 0 && refundAmount > 0
    ? roundNaira((orderTaxAmount / orderTotalAmount) * refundAmount)
    : 0;

export type FinanceComponents = {
  platformFees: number;
  serviceCharges: number;
  paystackFees: number;
  vatCollected: number;
  vatRefunded: number;
  refundsIssued: number;
  refundsAbsorbed: number;
  clawbackRecovered: number;
  promoCosts: number;
};

export const emptyFinanceComponents = (): FinanceComponents => ({
  platformFees: 0,
  serviceCharges: 0,
  paystackFees: 0,
  vatCollected: 0,
  vatRefunded: 0,
  refundsIssued: 0,
  refundsAbsorbed: 0,
  clawbackRecovered: 0,
  promoCosts: 0,
});

export const summarizeFinance = (c: FinanceComponents) => {
  const commission = roundNaira(c.platformFees + c.serviceCharges);
  const totalCosts = roundNaira(c.paystackFees + c.refundsAbsorbed + c.promoCosts);
  return {
    commission,
    platformFees: roundNaira(c.platformFees),
    serviceCharges: roundNaira(c.serviceCharges),
    paystackFees: roundNaira(c.paystackFees),
    refundsIssued: roundNaira(c.refundsIssued),
    refundsAbsorbed: roundNaira(c.refundsAbsorbed),
    clawbackRecovered: roundNaira(c.clawbackRecovered),
    promoCosts: roundNaira(c.promoCosts),
    vatCollected: roundNaira(Math.max(c.vatCollected - c.vatRefunded, 0)),
    totalCosts,
    netProfit: roundNaira(commission - totalCosts),
  };
};
