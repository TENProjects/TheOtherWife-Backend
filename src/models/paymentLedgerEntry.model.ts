/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

// Append-only audit trail of every money-relevant event on a Payment —
// created alongside (never instead of) the mutable Payment document, which
// remains the source of truth for "current state" queries. This collection
// answers a different question: "what happened, in what order, and can we
// prove nothing was altered after the fact." See PaymentLedgerService for
// the only code allowed to write to it.
export type PaymentLedgerEntryType =
  | "payment_created"
  | "payment_initiated"
  | "payment_succeeded"
  | "payment_failed"
  | "payment_cancelled"
  | "payment_refunded"
  | "vendor_settlement_synced"
  | "vendor_payout_allocated"
  | "vendor_split_settled"
  | "vendor_clawback_applied";

export type PaymentLedgerActorType =
  | "system"
  | "webhook"
  | "admin"
  | "customer"
  | "vendor";

export interface PaymentLedgerBalances {
  vendorNetAmount: number;
  vendorSettledAmount: number;
  vendorClawbackAmount: number;
  settlementStatus: string;
}

export interface PaymentLedgerEntryDocument extends Document {
  // Global, gapless, monotonically increasing — this (not _id/createdAt) is
  // what defines chain order and lets a verifier walk every entry in
  // sequence regardless of which payment it belongs to.
  sequenceNumber: number;
  paymentId: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  mealPlanId?: mongoose.Types.ObjectId;
  entryType: PaymentLedgerEntryType;
  // Magnitude of money movement this specific entry represents — 0 for
  // pure status/metadata transitions (e.g. Paystack authorization created).
  amount: number;
  currency: string;
  previousStatus?: string;
  newStatus: string;
  // Full snapshot of the money-relevant fields immediately AFTER this
  // entry — lets an auditor reconstruct the payment's state at any point
  // in its history without replaying every prior entry.
  balancesSnapshot: PaymentLedgerBalances;
  actorType: PaymentLedgerActorType;
  actorId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  // SHA-256 of the immediately preceding entry (by sequenceNumber) —
  // "0".repeat(64) for the very first entry ever written. Chaining like
  // this means altering or deleting any single row, anywhere in the
  // history, breaks every hash after it — detectable by
  // PaymentLedgerService.verifyChainIntegrity() even if the tampering
  // happened directly against the database, bypassing the application
  // entirely.
  previousEntryHash: string;
  entryHash: string;
  createdAt: Date;
}

const PaymentLedgerEntrySchema = new Schema(
  {
    sequenceNumber: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
    },
    mealPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MealPlan",
      required: false,
    },
    entryType: {
      type: String,
      enum: [
        "payment_created",
        "payment_initiated",
        "payment_succeeded",
        "payment_failed",
        "payment_cancelled",
        "payment_refunded",
        "vendor_settlement_synced",
        "vendor_payout_allocated",
        "vendor_split_settled",
        "vendor_clawback_applied",
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
    previousStatus: {
      type: String,
      required: false,
    },
    newStatus: {
      type: String,
      required: true,
    },
    balancesSnapshot: {
      vendorNetAmount: { type: Number, required: true },
      vendorSettledAmount: { type: Number, required: true },
      vendorClawbackAmount: { type: Number, required: true },
      settlementStatus: { type: String, required: true },
    },
    actorType: {
      type: String,
      enum: ["system", "webhook", "admin", "customer", "vendor"],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: false,
    },
    previousEntryHash: {
      type: String,
      required: true,
    },
    entryHash: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Technical enforcement of "immutable" — not just convention. Any attempt
// to update or delete a ledger entry, from anywhere in the codebase
// (present or future), fails hard instead of silently succeeding.
const forbidMutation = () => {
  throw new Error(
    "PaymentLedgerEntry records are immutable and may never be updated or deleted.",
  );
};
PaymentLedgerEntrySchema.pre(
  ["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "findOneAndDelete", "deleteMany"],
  forbidMutation,
);

export default model<PaymentLedgerEntryDocument>(
  "PaymentLedgerEntry",
  PaymentLedgerEntrySchema,
);
