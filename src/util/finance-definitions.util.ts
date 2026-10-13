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
