/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus, type HttpStatusCodeType } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Payment from "../models/payment.model.js";
import VendorPayoutRequest, {
  type VendorPayoutRequestDocument,
} from "../models/vendorPayoutRequest.model.js";
import {
  payoutTransferDailyLimit,
  payoutTransferMaxAmount,
  payoutTransfersEnabled,
} from "../constants/env.js";
import { transaction } from "../util/transaction.util.js";
import {
  estimateTransferFee,
  PaystackNetworkError,
  paystackTransferService,
  type PaystackTransferResult,
} from "./paystack-transfer.service.js";
import { PaystackSubaccountService } from "./paystack-subaccount.service.js";
import { VendorWalletService } from "./vendor-wallet.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Automatic vendor payouts through Paystack Transfers.
//
// An approved payout request is sent from TOW's Paystack balance to the
// vendor's bank. Money state changes in exactly one place each:
//   - send(): atomically claims the request (transfer.status "pending"), so a
//     double click, two admins or a retry can never start two transfers;
//   - applyOutcome(): the ONLY path that records a result, used by the
//     webhook, the reconciliation job and send() itself. A success is
//     re-verified with Paystack before the request is marked paid, and is
//     recorded through the same code as a manual payout.
// An unclear answer (timeout, unknown status) is never treated as a failure:
// the transfer stays "pending" until Paystack confirms either way, because
// the money may have moved.
// ─────────────────────────────────────────────────────────────────────────────

const MINUTE_MS = 60 * 1000;
const RECONCILE_AFTER_MS = 2 * MINUTE_MS;
// A transfer Paystack still has no record of this long after we started it
// never reached Paystack (the request failed in transit).
const NOT_FOUND_GIVE_UP_MS = 30 * MINUTE_MS;

const badRequest = (message: string, status: HttpStatusCodeType = HttpStatus.BAD_REQUEST) =>
  new BadRequestException(message, status, ErrorCode.VALIDATION_ERROR);

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);

// The bank's account name must plausibly be the vendor's: at least two name
// words in common (or one, when either name has only one word). Bank names
// are often reordered or abbreviated, so this compares words, not strings.
export const accountNamesMatch = (bankName?: string, submittedName?: string): boolean => {
  if (!bankName || !submittedName) return false;
  const bankTokens = new Set(normalizeName(bankName));
  const submitted = normalizeName(submittedName);
  const shared = submitted.filter((token) => bankTokens.has(token)).length;
  const needed = Math.min(2, bankTokens.size, submitted.length);
  return needed > 0 && shared >= needed;
};

const sameName = (a?: string, b?: string) =>
  !!a && !!b && normalizeName(a).join(" ") === normalizeName(b).join(" ");

const payoutAmountOf = (request: VendorPayoutRequestDocument) =>
  request.approvedAmount > 0 ? request.approvedAmount : request.requestedAmount;

export type PayoutTransferPreview = {
  enabled: boolean;
  amount: number;
  estimatedFee: number;
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  submittedAccountName: string | null;
  verifiedAccountName: string | null;
  accountNameMatches: boolean;
  vendorAvailableBalance: number;
  paystackBalance: number | null;
  sentLast24Hours: number;
  limits: { perPayout: number; per24Hours: number };
  blockers: string[];
};

export class PayoutTransferService {
  private vendorWalletService = new VendorWalletService();
  private subaccountService = new PaystackSubaccountService();

  get enabled() {
    return payoutTransfersEnabled;
  }

  // Same figure as the vendor's wallet "available to payout".
  private vendorAvailableBalance = async (vendorId: mongoose.Types.ObjectId) => {
    const [summary] = await Payment.aggregate<{ owed: number }>([
      { $match: { vendorId, status: { $in: ["succeeded", "refunded"] } } },
      {
        $group: {
          _id: null,
          owed: {
            $sum: {
              $subtract: [
                "$vendorNetAmount",
                { $add: ["$vendorSettledAmount", { $ifNull: ["$vendorClawbackAmount", 0] }] },
              ],
            },
          },
        },
      },
    ]);
    return Math.max(Math.round((summary?.owed ?? 0) * 100) / 100, 0);
  };

  private sentLast24Hours = async () => {
    const [row] = await VendorPayoutRequest.aggregate<{ total: number }>([
      {
        $match: {
          "transfer.status": { $in: ["pending", "success", "needs_review"] },
          "transfer.initiatedAt": { $gte: new Date(Date.now() - 24 * 60 * MINUTE_MS) },
        },
      },
      { $group: { _id: null, total: { $sum: "$transfer.amount" } } },
    ]);
    return row?.total ?? 0;
  };

  private loadRequest = async (requestId: string) => {
    if (!mongoose.isValidObjectId(requestId)) {
      throw new NotFoundException(
        "Payout request not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    const request = await VendorPayoutRequest.findById(requestId);
    if (!request) {
      throw new NotFoundException(
        "Payout request not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return request;
  };

  // Everything the admin sees before sending, and every reason sending is
  // not allowed. send() re-runs this; the screen never decides.
  preview = async (requestId: string): Promise<PayoutTransferPreview> => {
    const request = await this.loadRequest(requestId);
    const amount = payoutAmountOf(request);
    const bank = request.bankDetailsSnapshot ?? {};
    const blockers: string[] = [];

    if (!this.enabled) blockers.push("Automatic payouts are switched off. Pay by bank transfer and mark it as paid.");
    if (request.status !== "approved") blockers.push("Approve the request first.");
    if (request.paymentStatus === "paid") blockers.push("This payout is already paid.");
    if (request.transfer?.status === "pending") blockers.push("A Paystack payout for this request is already in progress.");
    if (request.transfer?.status === "needs_review") blockers.push("The last Paystack transfer needs review in the Paystack dashboard.");
    if (amount > payoutTransferMaxAmount) {
      blockers.push(`Above the automatic payout limit of ₦${payoutTransferMaxAmount.toLocaleString()}. Pay this one manually.`);
    }

    const [vendorAvailableBalance, sentLast24Hours] = await Promise.all([
      this.vendorAvailableBalance(request.vendorId),
      this.sentLast24Hours(),
    ]);
    if (amount > vendorAvailableBalance) {
      blockers.push("The amount is more than the vendor's available balance.");
    }
    if (sentLast24Hours + amount > payoutTransferDailyLimit) {
      blockers.push(`This would pass the 24-hour automatic payout limit of ₦${payoutTransferDailyLimit.toLocaleString()}.`);
    }

    let bankCode: string | null = null;
    let verifiedAccountName: string | null = null;
    if (!bank.bankName || !bank.accountNumber) {
      blockers.push("The request has no bank details.");
    } else if (this.enabled) {
      try {
        bankCode = await this.subaccountService.resolveBankCode(bank.bankName);
        const resolved = await paystackTransferService.resolveAccount(bank.accountNumber, bankCode);
        verifiedAccountName = resolved.accountName;
      } catch (error: any) {
        blockers.push(
          error instanceof PaystackNetworkError
            ? "Paystack could not be reached to check the account. Try again shortly."
            : error?.message || "The bank account could not be verified.",
        );
      }
    }

    const accountNameMatches = accountNamesMatch(verifiedAccountName ?? undefined, bank.accountName);
    if (verifiedAccountName && !accountNameMatches) {
      blockers.push("The bank's account name doesn't match the name on the request. Confirm with the vendor and pay manually.");
    }

    let paystackBalance: number | null = null;
    if (this.enabled) {
      try {
        paystackBalance = await paystackTransferService.getBalance();
        if (paystackBalance < amount + estimateTransferFee(amount)) {
          blockers.push("TOW's Paystack balance is too low for this payout. Top it up first.");
        }
      } catch {
        blockers.push("Could not read TOW's Paystack balance. Try again shortly.");
      }
    }

    return {
      enabled: this.enabled,
      amount,
      estimatedFee: estimateTransferFee(amount),
      bankName: bank.bankName ?? null,
      bankCode,
      accountNumber: bank.accountNumber ?? null,
      submittedAccountName: bank.accountName ?? null,
      verifiedAccountName,
      accountNameMatches,
      vendorAvailableBalance,
      paystackBalance,
      sentLast24Hours,
      limits: { perPayout: payoutTransferMaxAmount, per24Hours: payoutTransferDailyLimit },
      blockers,
    };
  };

  // Admin "Send": the admin must type back (confirm) the bank's account name
  // shown in the preview, proving they saw who is being paid.
  send = async (adminUserId: string, requestId: string, confirmAccountName: string) => {
    const preview = await this.preview(requestId);
    if (preview.blockers.length > 0) {
      throw badRequest(preview.blockers[0]);
    }
    if (!sameName(confirmAccountName, preview.verifiedAccountName ?? undefined)) {
      throw badRequest("Confirm the account name exactly as the bank shows it.");
    }

    const current = await this.loadRequest(requestId);
    const previous = current.transfer;
    const attempts = (previous?.attempts ?? 0) + 1;
    const reference = `tow_po_${current._id.toString()}_${attempts}`;

    // Atomic claim: only one caller can move this request to "pending".
    const claimed = await VendorPayoutRequest.findOneAndUpdate(
      {
        _id: current._id,
        status: "approved",
        paymentStatus: "unpaid",
        ...(previous
          ? { "transfer.status": { $in: ["failed", "reversed"] }, "transfer.attempts": previous.attempts }
          : { transfer: { $exists: false } }),
      },
      {
        $set: {
          transfer: {
            status: "pending",
            reference,
            previousReferences: previous
              ? [...(previous.previousReferences ?? []), previous.reference]
              : [],
            attempts,
            amount: preview.amount,
            bankCode: preview.bankCode,
            accountNumber: preview.accountNumber,
            verifiedAccountName: preview.verifiedAccountName,
            initiatedBy: new mongoose.Types.ObjectId(adminUserId),
            initiatedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!claimed) {
      throw badRequest("This payout is already being sent or was just changed. Refresh and try again.", HttpStatus.CONFLICT);
    }

    let recipientCode: string;
    try {
      recipientCode = await paystackTransferService.createRecipient({
        name: preview.verifiedAccountName as string,
        accountNumber: preview.accountNumber as string,
        bankCode: preview.bankCode as string,
      });
    } catch (error: any) {
      // Nothing was sent: release the claim as failed so it can be retried.
      await this.markFailed(reference, "failed", error?.message || "Could not register the account with Paystack");
      throw badRequest(error?.message || "Could not register the account with Paystack");
    }
    await VendorPayoutRequest.updateOne(
      { "transfer.reference": reference },
      { $set: { "transfer.recipientCode": recipientCode } },
    );

    let result: PaystackTransferResult;
    try {
      result = await paystackTransferService.initiateTransfer({
        amountNaira: preview.amount,
        recipientCode,
        reference,
        reason: `TOW payout ${current._id.toString().slice(-6).toUpperCase()}`,
      });
    } catch (error) {
      if (error instanceof PaystackNetworkError) {
        // Unknown whether Paystack received it: stays pending; the
        // reconciliation job asks Paystack by reference.
        return this.describe(await this.loadRequest(requestId));
      }
      throw error;
    }

    await this.applyOutcome({ ...result, reference, recipientCode }, "initiate");
    return this.describe(await this.loadRequest(requestId));
  };

  private markFailed = async (
    reference: string,
    status: "failed" | "reversed" | "needs_review",
    reason: string,
  ) => {
    await VendorPayoutRequest.updateOne(
      { "transfer.reference": reference, "transfer.status": "pending" },
      {
        $set: {
          "transfer.status": status,
          "transfer.failureReason": reason.slice(0, 500),
          "transfer.completedAt": new Date(),
        },
      },
    );
  };

  // The single path that records what happened to a transfer.
  applyOutcome = async (
    result: PaystackTransferResult,
    source: "initiate" | "webhook" | "reconcile",
  ): Promise<{ handled: boolean; status?: string }> => {
    const reference = result.reference;
    if (!reference) return { handled: false };

    const request = await VendorPayoutRequest.findOne({ "transfer.reference": reference });
    if (!request?.transfer) {
      // An event for an older attempt, or not one of our payouts: never acted on.
      return { handled: false };
    }
    const transfer = request.transfer;

    // Paystack must be talking about exactly what we sent.
    const expectedKobo = Math.round(transfer.amount * 100);
    const amountMismatch = result.amountKobo !== undefined && Math.round(result.amountKobo) !== expectedKobo;
    const currencyMismatch = !!result.currency && result.currency !== "NGN";
    const recipientMismatch =
      !!result.recipientCode && !!transfer.recipientCode && result.recipientCode !== transfer.recipientCode;
    if (amountMismatch || currencyMismatch || recipientMismatch) {
      await this.markFailed(reference, "needs_review", "Paystack reported a different amount, currency or recipient than was sent");
      return { handled: true, status: "needs_review" };
    }

    if (result.transferCode && !transfer.transferCode) {
      await VendorPayoutRequest.updateOne(
        { _id: request._id },
        { $set: { "transfer.transferCode": result.transferCode } },
      );
    }

    switch (result.state) {
      case "success":
        return this.recordSuccess(request, result, source);
      case "failed":
        if (request.paymentStatus === "paid") {
          await this.markFailed(reference, "needs_review", "Paystack reported failure for a payout already recorded as paid");
          return { handled: true, status: "needs_review" };
        }
        await this.markFailed(reference, "failed", result.reason || "The bank did not accept the payout");
        return { handled: true, status: "failed" };
      case "otp":
        await this.markFailed(reference, "failed", "Transfer OTP is switched on in Paystack. Turn it off to pay automatically, or pay manually.");
        return { handled: true, status: "failed" };
      case "reversed":
        return this.recordReversal(request, result.reason || "The bank returned the payout");
      default:
        // pending / unknown: wait for a definite answer.
        return { handled: true, status: "pending" };
    }
  };

  private recordSuccess = async (
    request: VendorPayoutRequestDocument,
    result: PaystackTransferResult,
    source: "initiate" | "webhook" | "reconcile",
  ) => {
    const transfer = request.transfer!;
    if (transfer.status === "success" && request.paymentStatus === "paid") {
      return { handled: true, status: "success" };
    }
    if (transfer.status !== "pending") {
      // e.g. a success after we recorded a failure: a person must check.
      await VendorPayoutRequest.updateOne(
        { _id: request._id },
        { $set: { "transfer.status": "needs_review", "transfer.failureReason": "Paystack reported success after a different outcome was recorded" } },
      );
      return { handled: true, status: "needs_review" };
    }

    // Webhook/initiate successes are confirmed with Paystack before money
    // state changes (the reconciliation job already got it from Paystack).
    if (source !== "reconcile") {
      try {
        const verified = await paystackTransferService.verifyTransfer(transfer.reference);
        if (!verified || verified.state !== "success") {
          return { handled: true, status: "pending" };
        }
      } catch {
        return { handled: true, status: "pending" };
      }
    }

    if (request.paymentStatus !== "paid") {
      try {
        await this.vendorWalletService.updateAdminPayoutRequest(
          transfer.initiatedBy?.toString() ?? request.approvedBy?.toString() ?? "",
          request._id.toString(),
          {
            paymentStatus: "paid",
            payoutReference: result.transferCode || transfer.transferCode || transfer.reference,
            note: "Paid automatically through Paystack",
          },
          { actorType: source === "initiate" ? "admin" : "webhook", viaTransfer: true },
        );
      } catch (error: any) {
        // Recorded as paid by a parallel delivery of the same event.
        const fresh = await VendorPayoutRequest.findById(request._id);
        if (fresh?.paymentStatus !== "paid") throw error;
      }
    }

    await VendorPayoutRequest.updateOne(
      { _id: request._id, "transfer.reference": transfer.reference },
      { $set: { "transfer.status": "success", "transfer.completedAt": new Date() }, $unset: { "transfer.failureReason": "" } },
    );
    return { handled: true, status: "success" };
  };

  private recordReversal = async (request: VendorPayoutRequestDocument, reason: string) => {
    const reference = request.transfer!.reference;
    if (request.transfer!.status === "reversed") return { handled: true, status: "reversed" };

    if (request.paymentStatus !== "paid") {
      await VendorPayoutRequest.updateOne(
        { _id: request._id, "transfer.reference": reference },
        { $set: { "transfer.status": "reversed", "transfer.failureReason": reason, "transfer.completedAt": new Date() } },
      );
      return { handled: true, status: "reversed" };
    }

    // Already recorded as paid: give the vendor their balance back and
    // reopen the request, atomically.
    await transaction.use(async (session: ClientSession, requestId: string) => {
      const locked = await VendorPayoutRequest.findOneAndUpdate(
        { _id: requestId, paymentStatus: "paid", "transfer.reference": reference },
        {
          $set: {
            paymentStatus: "unpaid",
            "transfer.status": "reversed",
            "transfer.failureReason": reason,
            "transfer.completedAt": new Date(),
          },
          $unset: { paidAt: "", payoutReference: "" },
        },
        { session, new: true },
      );
      if (!locked) return;
      await this.vendorWalletService.reverseRecordedPayout(session, locked._id as mongoose.Types.ObjectId, reason);
    })(request._id.toString());

    return { handled: true, status: "reversed" };
  };

  // Webhook entry point (signature already verified by the caller).
  handleTransferWebhook = async (event: { event?: string; data?: any }) => {
    const data = event.data ?? {};
    const state =
      event.event === "transfer.success"
        ? "success"
        : event.event === "transfer.failed"
        ? "failed"
        : event.event === "transfer.reversed"
        ? "reversed"
        : null;
    if (!state) return { handled: false };
    return this.applyOutcome(
      {
        state,
        rawStatus: String(data.status ?? state),
        reference: typeof data.reference === "string" ? data.reference : undefined,
        transferCode: data.transfer_code,
        amountKobo: typeof data.amount === "number" ? data.amount : undefined,
        currency: data.currency,
        recipientCode: data.recipient?.recipient_code,
        reason: data.reason ?? data.gateway_response,
      },
      "webhook",
    );
  };

  // Paystack's transfer approval request: approve only a transfer this
  // server started, for exactly this amount. Read-only.
  isApprovedTransfer = async (data: { reference?: string; amount?: number; recipient?: { recipient_code?: string } }) => {
    if (typeof data?.reference !== "string") return false;
    const request = await VendorPayoutRequest.findOne({
      "transfer.reference": data.reference,
      "transfer.status": "pending",
    }).select("transfer");
    if (!request?.transfer) return false;
    if (typeof data.amount === "number" && Math.round(data.amount) !== Math.round(request.transfer.amount * 100)) {
      return false;
    }
    const recipient = data.recipient?.recipient_code;
    if (recipient && request.transfer.recipientCode && recipient !== request.transfer.recipientCode) {
      return false;
    }
    return true;
  };

  // Cron: settle transfers still pending after a couple of minutes by asking
  // Paystack directly. Safe to run repeatedly and in parallel.
  reconcilePendingTransfers = async ({ limit = 50 }: { limit?: number } = {}) => {
    const pending = await VendorPayoutRequest.find({
      "transfer.status": "pending",
      "transfer.initiatedAt": { $lte: new Date(Date.now() - RECONCILE_AFTER_MS) },
    })
      .sort({ "transfer.initiatedAt": 1 })
      .limit(Math.min(Math.max(limit, 1), 200));

    const summary = { scanned: pending.length, settled: 0, stillPending: 0, errors: 0 };
    for (const request of pending) {
      const transfer = request.transfer!;
      try {
        const result = await paystackTransferService.verifyTransfer(transfer.reference);
        if (!result) {
          const age = Date.now() - (transfer.initiatedAt?.getTime() ?? Date.now());
          if (age >= NOT_FOUND_GIVE_UP_MS) {
            await this.markFailed(transfer.reference, "failed", "Paystack never received this payout");
            summary.settled += 1;
          } else {
            summary.stillPending += 1;
          }
          continue;
        }
        const outcome = await this.applyOutcome({ ...result, reference: transfer.reference }, "reconcile");
        if (outcome.status === "pending") summary.stillPending += 1;
        else summary.settled += 1;
      } catch {
        summary.errors += 1;
      }
    }
    return summary;
  };

  // What the admin screen shows about a request's automatic payout.
  describe = (request: VendorPayoutRequestDocument) => ({
    payoutRequestId: request._id.toString(),
    status: request.status,
    paymentStatus: request.paymentStatus,
    transfer: request.transfer
      ? {
          status: request.transfer.status,
          amount: request.transfer.amount,
          attempts: request.transfer.attempts,
          transferCode: request.transfer.transferCode ?? null,
          verifiedAccountName: request.transfer.verifiedAccountName ?? null,
          initiatedAt: request.transfer.initiatedAt ?? null,
          completedAt: request.transfer.completedAt ?? null,
          failureReason: request.transfer.failureReason ?? null,
        }
      : null,
  });
}

export const payoutTransferService = new PayoutTransferService();

