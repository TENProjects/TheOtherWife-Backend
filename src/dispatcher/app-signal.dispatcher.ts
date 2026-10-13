/** @format */

import { SignalDispatcher } from "./signal.dispatcher.js";

export type AppSignals = {
  // Emitted exactly once, when an order's payment is confirmed (webhook,
  // reconciliation, wallet-only or a meal-plan delivery). This — not order
  // creation — is the moment a vendor is told about a new order: an Order is
  // created as "pending_payment" before the customer pays, and an unpaid
  // checkout must never reach a vendor. (The old "order.created" signal was
  // removed for that reason.)
  "order.paid": {
    orderId: string;
    customerUserId: string;
    vendorId: string;
    totalAmount: number;
    currency: string;
  };
  // A Paystack payment that completed after its checkout had already been
  // closed for non-payment. The order stays cancelled (the vendor never saw
  // it) and a refund request is opened; only the customer is told.
  "order.payment_received_after_expiry": {
    orderId: string;
    customerUserId: string;
    amount: number;
    currency: string;
  };
  "order.status_changed": {
    orderId: string;
    customerUserId: string;
    vendorId: string;
    previousStatus: string;
    currentStatus: string;
  };
  "vendor.approved": {
    vendorId: string;
    vendorUserId: string;
    approvedByUserId: string;
  };
};

export const appSignalDispatcher = new SignalDispatcher<AppSignals>();
