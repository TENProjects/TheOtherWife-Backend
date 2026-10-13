/** @format */

// Single source of truth for which orders each audience may see. An Order is
// created as "pending_payment" BEFORE the customer pays (the Paystack
// reference has to exist first), so every customer-, vendor- and
// analytics-facing query must filter through these helpers — an unpaid or
// abandoned checkout is not an order anyone should see or count.

// Money was actually received for these (a refunded order was paid first).
export const PAID_PAYMENT_STATUSES = ["paid", "refunded"] as const;

// The reason recorded when a checkout is closed because it was never paid
// (expired, abandoned, superseded or a failed charge).
export const UNPAID_CANCELLATION_REASON = "payment_timeout";

// Orders the customer sees in their own history: anything they paid for,
// including ones later cancelled or refunded. Never unpaid checkouts.
export const customerVisibleOrderFilter = (): Record<string, unknown> => ({
  paymentStatus: { $in: [...PAID_PAYMENT_STATUSES] },
});

// Orders a vendor sees: paid orders only, and never a checkout that was
// closed for non-payment. (A payment that lands AFTER its checkout expired is
// refunded to the customer — the vendor was never asked to cook it.)
export const vendorVisibleOrderFilter = (): Record<string, unknown> => ({
  paymentStatus: { $in: [...PAID_PAYMENT_STATUSES] },
  cancellationReason: { $ne: UNPAID_CANCELLATION_REASON },
});

// Admin-only: checkouts that never turned into a paid order — still awaiting
// payment, or closed because payment never completed.
export const unpaidCheckoutFilter = (): Record<string, unknown> => ({
  $or: [
    { status: "pending_payment" },
    {
      status: "cancelled",
      cancellationReason: UNPAID_CANCELLATION_REASON,
      paymentStatus: { $nin: [...PAID_PAYMENT_STATUSES] },
    },
  ],
});

export const isCustomerVisibleOrder = (order: {
  paymentStatus?: string;
}): boolean =>
  (PAID_PAYMENT_STATUSES as readonly string[]).includes(order.paymentStatus ?? "");

export const isVendorVisibleOrder = (order: {
  paymentStatus?: string;
  cancellationReason?: string;
}): boolean =>
  isCustomerVisibleOrder(order) &&
  order.cancellationReason !== UNPAID_CANCELLATION_REASON;
