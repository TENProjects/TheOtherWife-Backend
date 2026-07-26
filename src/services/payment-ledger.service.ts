/** @format */

import crypto from "crypto";
import mongoose, { ClientSession } from "mongoose";
import Counter from "../models/counter.model.js";
import PaymentLedgerEntry, {
  PaymentLedgerActorType,
  PaymentLedgerEntryType,
} from "../models/paymentLedgerEntry.model.js";
import { PaymentDocument } from "../models/payment.model.js";

const CHAIN_SEQUENCE_NAME = "paymentLedger";
const GENESIS_HASH = "0".repeat(64);

type RecordInput = {
  payment: PaymentDocument;
  entryType: PaymentLedgerEntryType;
  amount?: number;
  previousStatus?: string;
  actorType: PaymentLedgerActorType;
  actorId?: string;
  metadata?: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PaymentLedgerService {
  private computeHash = (input: {
    sequenceNumber: number;
    paymentId: string;
    entryType: string;
    amount: number;
    currency: string;
    previousStatus?: string;
    newStatus: string;
    balancesSnapshot: Record<string, unknown>;
    previousEntryHash: string;
  }): string =>
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          sequenceNumber: input.sequenceNumber,
          paymentId: input.paymentId,
          entryType: input.entryType,
          amount: input.amount,
          currency: input.currency,
          previousStatus: input.previousStatus ?? null,
          newStatus: input.newStatus,
          balancesSnapshot: input.balancesSnapshot,
          previousEntryHash: input.previousEntryHash,
        }),
      )
      .digest("hex");

  // Looks up the entry immediately before `sequenceNumber` in the chain.
  // Under normal load this is already committed by the time we look for it
  // (sequence numbers are assigned atomically, but the *write* of the
  // predecessor entry can very rarely still be in flight) — a few short
  // retries cover that window without requiring a distributed lock for
  // what is, in practice, a low-frequency write path.
  private getPreviousHash = async (
    sequenceNumber: number,
    session: ClientSession | undefined,
  ): Promise<string> => {
    if (sequenceNumber <= 1) return GENESIS_HASH;

    for (let attempt = 0; attempt < 8; attempt++) {
      const query = PaymentLedgerEntry.findOne({
        sequenceNumber: sequenceNumber - 1,
      }).select("entryHash");
      if (session) query.session(session);
      const previous = await query;
      if (previous) return previous.entryHash;
      await sleep(25);
    }

    // Predecessor never showed up — record this entry anyway rather than
    // lose a financial event, but mark the break explicitly so
    // verifyChainIntegrity() reports it instead of silently passing.
    console.error(
      `PaymentLedgerService: predecessor for sequence ${sequenceNumber} not found after retries — recording with a marked chain break.`,
    );
    return "CHAIN_BREAK_PREDECESSOR_NOT_FOUND".padEnd(64, "0");
  };

  // Never throws — a ledger-write failure must never break the actual
  // payment/checkout/webhook/payout flow that's recording it. Failures are
  // logged loudly instead, since a missing ledger entry is a real problem
  // that needs human attention, just not one that should fail a customer's
  // checkout.
  record = async (
    session: ClientSession | undefined,
    input: RecordInput,
  ): Promise<void> => {
    try {
      const { payment, entryType, actorType } = input;
      const paymentId = (payment._id as mongoose.Types.ObjectId).toString();

      const counterQuery = Counter.findOneAndUpdate(
        { _id: CHAIN_SEQUENCE_NAME },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      );
      if (session) counterQuery.session(session);
      const counter = await counterQuery;
      const sequenceNumber = counter.seq;

      const previousEntryHash = await this.getPreviousHash(sequenceNumber, session);

      const balancesSnapshot = {
        vendorNetAmount: payment.vendorNetAmount ?? 0,
        vendorSettledAmount: payment.vendorSettledAmount ?? 0,
        vendorClawbackAmount: payment.vendorClawbackAmount ?? 0,
        settlementStatus: payment.settlementStatus,
      };
      const amount = input.amount ?? 0;
      const currency = payment.currency;
      const newStatus = payment.status;

      const entryHash = this.computeHash({
        sequenceNumber,
        paymentId,
        entryType,
        amount,
        currency,
        previousStatus: input.previousStatus,
        newStatus,
        balancesSnapshot,
        previousEntryHash,
      });

      const doc = {
        sequenceNumber,
        paymentId: payment._id,
        orderId: payment.orderId,
        mealPlanId: payment.mealPlanId,
        entryType,
        amount,
        currency,
        previousStatus: input.previousStatus,
        newStatus,
        balancesSnapshot,
        actorType,
        actorId: input.actorId,
        metadata: input.metadata,
        previousEntryHash,
        entryHash,
      };

      if (session) {
        await PaymentLedgerEntry.create([doc], { session });
      } else {
        await PaymentLedgerEntry.create(doc);
      }
    } catch (error) {
      console.error("PaymentLedgerService.record failed — payment operation is unaffected:", {
        paymentId: input.payment?._id?.toString?.(),
        entryType: input.entryType,
        error,
      });
    }
  };

  // Walks the full chain in sequence order and recomputes every hash from
  // its stored content, confirming each entry's previousEntryHash matches
  // its actual predecessor's entryHash. Any mismatch — an edited amount, a
  // deleted row, a reordered entry — breaks the chain from that point
  // forward and is reported here, regardless of whether the tampering went
  // through this application at all.
  verifyChainIntegrity = async (): Promise<{
    valid: boolean;
    totalEntries: number;
    brokenAtSequence?: number;
    reason?: string;
  }> => {
    const entries = await PaymentLedgerEntry.find()
      .sort({ sequenceNumber: 1 })
      .lean();

    let expectedPreviousHash = GENESIS_HASH;

    for (const entry of entries) {
      if (entry.previousEntryHash !== expectedPreviousHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAtSequence: entry.sequenceNumber,
          reason: "previousEntryHash does not match the prior entry's hash",
        };
      }

      const recomputed = this.computeHash({
        sequenceNumber: entry.sequenceNumber,
        paymentId: entry.paymentId.toString(),
        entryType: entry.entryType,
        amount: entry.amount,
        currency: entry.currency,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        balancesSnapshot: entry.balancesSnapshot,
        previousEntryHash: entry.previousEntryHash,
      });

      if (recomputed !== entry.entryHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAtSequence: entry.sequenceNumber,
          reason: "stored entryHash does not match its recomputed content hash — this entry was altered after being written",
        };
      }

      expectedPreviousHash = entry.entryHash;
    }

    return { valid: true, totalEntries: entries.length };
  };

  getEntriesForPayment = async (paymentId: string) => {
    return PaymentLedgerEntry.find({ paymentId }).sort({ sequenceNumber: 1 });
  };
}
