/** @format */

import { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import Wallet from "../models/wallet.model.js";
import WalletTransaction from "../models/walletTransaction.model.js";

export class WalletService {
  private ensureWallet = async (
    userId: string,
    currency: string,
    session?: ClientSession,
  ) => {
    const walletQuery = Wallet.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          userId,
          walletType: "promo",
          currency,
          availableBalance: 0,
          withdrawable: false,
        },
      },
      { new: true, upsert: true },
    );

    if (session) {
      walletQuery.session(session);
    }

    return await walletQuery;
  };

  getWalletBalance = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const wallet = await this.ensureWallet(userId, "NGN");

    return {
      wallet: {
        availableBalance: wallet.availableBalance,
        currency: wallet.currency,
        walletType: wallet.walletType,
        withdrawable: wallet.withdrawable,
      },
    };
  };

  reserveWalletAmountForOrder = async (
    session: ClientSession,
    userId: string,
    orderId: string,
    orderTotal: number,
    currency: string,
  ) => {
    const existingReservation = await WalletTransaction.findOne({
      userId,
      transactionType: "promo_spend",
      referenceType: "order",
      referenceId: orderId,
    }).session(session);

    if (existingReservation && existingReservation.status !== "reversed") {
      const walletAmountApplied = existingReservation.amount;
      return {
        walletAmountApplied,
        paystackAmountDue: Math.max(orderTotal - walletAmountApplied, 0),
      };
    }

    const wallet = await this.ensureWallet(userId, currency, session);
    const walletAmountApplied = Math.min(wallet.availableBalance, orderTotal);

    if (walletAmountApplied <= 0) {
      return {
        walletAmountApplied: 0,
        paystackAmountDue: orderTotal,
      };
    }

    wallet.availableBalance -= walletAmountApplied;
    await wallet.save({ session });

    await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          walletType: wallet.walletType,
          transactionType: "promo_spend",
          amount: walletAmountApplied,
          currency: wallet.currency,
          status: "pending",
          referenceType: "order",
          referenceId: orderId,
          metadata: {
            phase: "reserved",
          },
        },
      ],
      { session },
    );

    return {
      walletAmountApplied,
      paystackAmountDue: Math.max(orderTotal - walletAmountApplied, 0),
    };
  };

  finalizeReservedWalletForOrder = async (
    session: ClientSession,
    userId: string,
    orderId: string,
  ) => {
    const reservation = await WalletTransaction.findOne({
      userId,
      transactionType: "promo_spend",
      referenceType: "order",
      referenceId: orderId,
      status: "pending",
    }).session(session);

    if (!reservation) {
      return { finalized: false };
    }

    reservation.status = "posted";
    reservation.metadata = {
      ...(reservation.metadata ?? {}),
      phase: "settled",
    };
    await reservation.save({ session });

    return { finalized: true, amount: reservation.amount };
  };

  // Refund destination is always the customer's in-app wallet, never back to
  // the card (Financial & Commission Spec v1.0, section 4/6.1). Used by both
  // refund Scenario A (automatic clawback) and Scenario B (admin dispute).
  creditWalletForRefund = async (
    session: ClientSession,
    userId: string,
    orderId: string,
    amount: number,
    currency: string,
  ) => {
    const wallet = await this.ensureWallet(userId, currency, session);
    wallet.availableBalance += amount;
    await wallet.save({ session });

    await WalletTransaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          walletType: wallet.walletType,
          transactionType: "refund_credit",
          amount,
          currency: wallet.currency,
          status: "posted",
          referenceType: "order",
          referenceId: orderId,
        },
      ],
      { session },
    );

    return { creditedAmount: amount, newBalance: wallet.availableBalance };
  };

  releaseReservedWalletForOrder = async (
    session: ClientSession,
    userId: string,
    orderId: string,
  ) => {
    const reservation = await WalletTransaction.findOne({
      userId,
      transactionType: "promo_spend",
      referenceType: "order",
      referenceId: orderId,
      status: "pending",
    }).session(session);

    if (!reservation) {
      return { released: false };
    }

    const wallet = await this.ensureWallet(userId, reservation.currency, session);
    wallet.availableBalance += reservation.amount;
    await wallet.save({ session });

    reservation.status = "reversed";
    reservation.metadata = {
      ...(reservation.metadata ?? {}),
      phase: "released",
    };
    await reservation.save({ session });

    return { released: true, amount: reservation.amount };
  };
}
