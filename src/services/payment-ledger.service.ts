/** @format */

import crypto from "crypto";
import mongoose, { ClientSession } from "mongoose";
import Counter from "../models/counter.model.js";
import PaymentLedgerEntry, {
  PaymentLedgerActorType,
  PaymentLedgerEntryType,
} from "../models/paymentLedgerEntry.model.js";
import { PaymentDocument } from "../models/payment.model.js";
import { mailer } from "./email.service.js";
import { ledgerCheckpointEmail } from "../constants/env.js";

const CHAIN_SEQUENCE_NAME = "paymentLedger";
const GENESIS_HASH = "0".repeat(64);

// Distinct, greppable prefix for every checkpoint log line — these flow
// into the hosting platform's own log storage (Vercel/DigitalOcean), which
// is a genuinely separate system from MongoDB with its own credentials. An
// attacker who fully compromises the database does not, by that alone,
// also gain access to the platform's log archive or the checkpoint email
// inbox — so a checkpoint recorded in either place can catch tampering
// that happened entirely at the database level, after the fact.
const CHECKPOINT_LOG_PREFIX = "PAYMENT_LEDGER_CHECKPOINT";

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

      // Real-time external anchor — lands in platform log storage
      // independent of the database itself. See CHECKPOINT_LOG_PREFIX.
      console.log(
        `${CHECKPOINT_LOG_PREFIX} seq=${sequenceNumber} hash=${entryHash} entryType=${entryType} paymentId=${paymentId}`,
      );
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
  //
  // IMPORTANT LIMITATION: on its own, this only proves the chain currently
  // in the database is *internally self-consistent* — it does NOT prove
  // that chain is genuinely what happened historically. Someone with full
  // database access could delete the whole collection and regenerate a
  // new, self-consistent chain from scratch, and this check alone would
  // still report "valid". Pass `trustedCheckpoint` (a sequenceNumber/hash
  // pair sourced from an EXTERNAL record — the checkpoint email or a
  // platform log line, never from the database itself) to additionally
  // confirm the live chain still agrees with a point in time that a
  // database-only attacker could not have retroactively rewritten.
  verifyChainIntegrity = async (trustedCheckpoint?: {
    sequenceNumber: number;
    entryHash: string;
  }): Promise<{
    valid: boolean;
    totalEntries: number;
    brokenAtSequence?: number;
    reason?: string;
    checkpointMatched?: boolean;
  }> => {
    const entries = await PaymentLedgerEntry.find()
      .sort({ sequenceNumber: 1 })
      .lean();

    let expectedPreviousHash = GENESIS_HASH;
    let checkpointMatched: boolean | undefined =
      trustedCheckpoint ? false : undefined;

    for (const entry of entries) {
      if (entry.previousEntryHash !== expectedPreviousHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAtSequence: entry.sequenceNumber,
          reason: "previousEntryHash does not match the prior entry's hash",
          checkpointMatched,
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
          reason:
            "stored entryHash does not match its recomputed content hash — this entry was altered after being written",
          checkpointMatched,
        };
      }

      if (
        trustedCheckpoint &&
        entry.sequenceNumber === trustedCheckpoint.sequenceNumber
      ) {
        checkpointMatched = entry.entryHash === trustedCheckpoint.entryHash;
        if (!checkpointMatched) {
          return {
            valid: false,
            totalEntries: entries.length,
            brokenAtSequence: entry.sequenceNumber,
            reason:
              "entry at this sequence number no longer matches the externally recorded checkpoint hash — the chain was altered and regenerated after this checkpoint was taken",
            checkpointMatched: false,
          };
        }
      }

      expectedPreviousHash = entry.entryHash;
    }

    if (trustedCheckpoint && checkpointMatched === false) {
      // The checkpointed sequence number doesn't exist in the current
      // chain at all (e.g. the chain is now shorter than the checkpoint) —
      // just as serious as a hash mismatch.
      return {
        valid: false,
        totalEntries: entries.length,
        reason: `checkpoint sequence ${trustedCheckpoint.sequenceNumber} was not found in the current chain`,
        checkpointMatched: false,
      };
    }

    return { valid: true, totalEntries: entries.length, checkpointMatched };
  };

  getEntriesForPayment = async (paymentId: string) => {
    return PaymentLedgerEntry.find({ paymentId }).sort({ sequenceNumber: 1 });
  };

  // Publishes the current chain HEAD (latest entry) somewhere outside the
  // database — a structured log line always, plus an email if
  // LEDGER_CHECKPOINT_EMAIL is configured. Meant to run on a schedule (see
  // internal-cron.route.ts) so a checkpoint exists even during a quiet
  // period with no new ledger writes.
  emitCheckpoint = async (): Promise<{
    sequenceNumber: number;
    entryHash: string;
    totalEntries: number;
  } | null> => {
    const latest = await PaymentLedgerEntry.findOne()
      .sort({ sequenceNumber: -1 })
      .lean();

    if (!latest) {
      console.log(`${CHECKPOINT_LOG_PREFIX} empty chain — nothing to checkpoint`);
      return null;
    }

    const totalEntries = await PaymentLedgerEntry.countDocuments();
    const checkpoint = {
      sequenceNumber: latest.sequenceNumber,
      entryHash: latest.entryHash,
      totalEntries,
    };

    console.log(
      `${CHECKPOINT_LOG_PREFIX} scheduled seq=${checkpoint.sequenceNumber} hash=${checkpoint.entryHash} totalEntries=${totalEntries} at=${new Date().toISOString()}`,
    );

    if (ledgerCheckpointEmail) {
      try {
        await mailer.sendSystemAlert(
          ledgerCheckpointEmail,
          `Payment Ledger Checkpoint — sequence #${checkpoint.sequenceNumber}`,
          `
            <p>Scheduled payment ledger checkpoint.</p>
            <ul>
              <li><strong>Sequence number:</strong> ${checkpoint.sequenceNumber}</li>
              <li><strong>Entry hash:</strong> ${checkpoint.entryHash}</li>
              <li><strong>Total entries:</strong> ${totalEntries}</li>
              <li><strong>Recorded at:</strong> ${new Date().toISOString()}</li>
            </ul>
            <p>Keep this email — to verify the ledger hasn't been altered since
            this point, enter this sequence number and hash into the "Verify
            Against External Checkpoint" field on the admin Financials →
            Payment Ledger tab at any later date.</p>
          `,
        );
      } catch (error) {
        console.error("Failed to send payment ledger checkpoint email:", error);
      }
    }

    return checkpoint;
  };
}
