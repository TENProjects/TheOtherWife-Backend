/** @format */

import crypto from "crypto";
import { ClientSession } from "mongoose";
import User, { UserDocument } from "../models/user.model.js";
import Customer from "../models/customer.model.js";
import Address from "../models/address.model.js";
import Favourites from "../models/favourites.model.js";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { InternalServerError } from "../errors/internal-server.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { transaction } from "../util/transaction.util.js";
import { getTemplate } from "../util/get-template.util.js";
import { getFormattedData } from "../util/get-maildata.js";
import { mailer, MailData } from "./email.service.js";
import { MailAction } from "../dispatcher/mail.dispatcher.js";
import { WalletService } from "./wallet.service.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

type Eligibility = { walletBalance: number; hasOpenOrders: boolean };

export class AccountDeletionService {
  private walletService = new WalletService();

  private hash = (value: string) =>
    crypto.createHash("sha256").update(value).digest("hex");

  private generateReference = () => {
    const segment = () => Math.floor(1000 + Math.random() * 9000).toString();
    return `TOW-${segment()}-${segment()}`;
  };

  private getEligibility = async (userId: string): Promise<Eligibility> => {
    const { wallet } = await this.walletService.getWalletBalance(userId);
    const hasOpenOrders = await Order.exists({
      customerId: userId,
      status: { $nin: ["delivered", "cancelled"] },
    });

    return { walletBalance: wallet.availableBalance, hasOpenOrders: !!hasOpenOrders };
  };

  // The shared errorHandler middleware only ever serializes an AppError as
  // { message, error, status } — it has no channel for arbitrary extra data,
  // and that's shared infrastructure every route relies on, not something to
  // extend for one feature. So ineligibility is a normal return value here
  // (not a throw) — the controller is the one that decides the 409 shape,
  // carrying `eligibility` in `data` so the frontend can re-render step 3
  // without redoing the OTP flow.
  private isIneligible = (
    deletionType: "full" | "erase_activity",
    eligibility: Eligibility,
  ): boolean => {
    if (eligibility.hasOpenOrders) return true;
    return deletionType === "full" && eligibility.walletBalance > 0;
  };

  // Strips customer-identifying freeform fields from an order while keeping
  // everything the vendor needs for their own records (pricing, status,
  // coarse location, timestamps) and everything Payment/ledger retention
  // needs (the order row itself, customerId ref). Shared by the
  // erase-activity confirm path and the hard-delete cron — same treatment
  // either way.
  private stripCustomerOrders = async (
    customerId: string,
    session: ClientSession,
  ) => {
    await Order.updateMany(
      { customerId },
      {
        $set: {
          customerHidden: true,
          "addressSnapshot.address": null,
          "addressSnapshot.latitude": 0,
          "addressSnapshot.longitude": 0,
        },
        $unset: {
          "items.$[].customization.cookingInstructions.note": "",
          "items.$[].customization.customProteinRequests": "",
          "items.$[].customization.customAddOnRequests": "",
          "items.$[].customization.customDrinkRequests": "",
        },
      },
      { session },
    );
  };

  // Wraps a mailer.relayTo call so a mail-provider failure (e.g. a
  // misconfigured RESEND_API_KEY) surfaces as a clean, retryable 503 instead
  // of an unhandled throw turning into a raw 500 for the caller.
  private sendOrThrow = async (
    data: MailData,
    action: (typeof MailAction)[keyof typeof MailAction],
    context: string,
  ) => {
    try {
      await mailer.relayTo(data, action);
    } catch (error) {
      console.error(`Failed to send ${context} email`, {
        userId: data.user._id.toString(),
        message: (error as Error)?.message,
      });
      throw new InternalServerError(
        "We couldn't send that email right now. Please try again in a moment.",
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.MAIL_DELIVERY_FAILED,
      );
    }
  };

  requestDeletion = async (
    email: string,
    deletionType: "full" | "erase_activity",
  ): Promise<void> => {
    const user = await User.findOne({ email });

    if (!user) return;

    if (user.userType === "vendor") {
      const htmlTemplate = await getTemplate(
        "src/templates",
        "delete-account-vendor-notice.template.html",
      );
      const { template } = getFormattedData(htmlTemplate, user);
      await this.sendOrThrow(
        { user, message: template } as MailData,
        MailAction.deleteAccountVendorNotice,
        "account-deletion vendor notice",
      );
      return;
    }

    if (user.userType !== "customer") return;

    const otp = crypto.randomInt(100000, 1000000).toString();
    const htmlTemplate = await getTemplate(
      "src/templates",
      "delete-account-otp.template.html",
    );
    const { template } = getFormattedData(htmlTemplate, user);
    const html = template.replaceAll("{{otpCode}}", otp);

    // Send first, persist second: if the mail fails, the user gets a clear
    // error telling them to retry, instead of an OTP silently saved to their
    // account that they can never actually receive or use.
    await this.sendOrThrow(
      { user, message: html } as MailData,
      MailAction.deleteAccountOtp,
      "account-deletion OTP",
    );

    user.deletionOtpHash = this.hash(otp);
    user.deletionOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    user.deletionOtpAttempts = 0;
    user.deletionType = deletionType;
    if (!user.deletionReference) {
      user.deletionReference = this.generateReference();
    }
    await user.save();
  };

  verifyOtp = async (
    email: string,
    code: string,
  ): Promise<{
    deletionToken: string;
    deletionType: "full" | "erase_activity";
    eligibility: Eligibility;
  }> => {
    const user = await User.findOne({ email, userType: "customer" });
    const invalidOrExpired = () =>
      new BadRequestException(
        "Invalid or expired code",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_INVALID_TOKEN,
      );

    if (
      !user ||
      !user.deletionOtpHash ||
      !user.deletionOtpExpiresAt ||
      user.deletionOtpExpiresAt < new Date()
    ) {
      throw invalidOrExpired();
    }

    if ((user.deletionOtpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        "Too many incorrect attempts. Please request a new code.",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_TOO_MANY_ATTEMPTS,
      );
    }

    if (this.hash(code) !== user.deletionOtpHash) {
      user.deletionOtpAttempts = (user.deletionOtpAttempts ?? 0) + 1;
      await user.save();
      throw invalidOrExpired();
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.deletionSessionTokenHash = this.hash(rawToken);
    user.deletionSessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    user.deletionOtpHash = undefined;
    user.deletionOtpExpiresAt = undefined;
    user.deletionOtpAttempts = 0;
    await user.save();

    const eligibility = await this.getEligibility(user._id.toString());

    return {
      deletionToken: rawToken,
      deletionType: (user.deletionType ?? "full") as "full" | "erase_activity",
      eligibility,
    };
  };

  confirmDeletion = async (
    deletionToken: string,
    reason?: string,
  ): Promise<
    | { status: "ok"; reference: string }
    | { status: "ineligible"; eligibility: Eligibility }
  > => {
    const user = await User.findOne({
      deletionSessionTokenHash: this.hash(deletionToken),
    });

    if (
      !user ||
      !user.deletionSessionExpiresAt ||
      user.deletionSessionExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        "This deletion request has expired. Please start again.",
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }

    const deletionType = (user.deletionType ?? "full") as
      | "full"
      | "erase_activity";
    const eligibility = await this.getEligibility(user._id.toString());

    if (this.isIneligible(deletionType, eligibility)) {
      return { status: "ineligible", eligibility };
    }

    const reference = user.deletionReference ?? this.generateReference();

    if (deletionType === "full") {
      await this.applyFullDeletion(user._id.toString(), reference, reason);

      const htmlTemplate = await getTemplate(
        "src/templates",
        "delete-account-scheduled.template.html",
      );
      const { template } = getFormattedData(htmlTemplate, user);
      const html = template.replaceAll("{{reference}}", reference);
      await mailer.relayTo(
        { user, message: html } as MailData,
        MailAction.deleteAccountScheduled,
      );
    } else {
      await this.applyEraseActivity(user._id.toString(), reference);

      const htmlTemplate = await getTemplate(
        "src/templates",
        "delete-account-activity-cleared.template.html",
      );
      const { template } = getFormattedData(htmlTemplate, user);
      const html = template.replaceAll("{{reference}}", reference);
      await mailer.relayTo(
        { user, message: html } as MailData,
        MailAction.deleteAccountActivityCleared,
      );
    }

    return { status: "ok", reference };
  };

  // Admin-facing (Super Admin > Account Deletions tab) — full-delete
  // requests still inside their 30-day grace period. Erase-activity
  // requests aren't listed here: that path is instant and non-reversible
  // by design, it never leaves the account in a pending state, so there's
  // nothing for an admin to see or act on afterward.
  listPendingDeletions = async (page = 1, limit = 20) => {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query = { status: "pending_deletion" };
    const [users, total] = await Promise.all([
      User.find(query)
        .select("firstName lastName email deletionReference deletionScheduledFor statusReason")
        .sort({ deletionScheduledFor: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      User.countDocuments(query),
    ]);

    const now = Date.now();
    const requests = users.map((user) => {
      const scheduledFor = user.deletionScheduledFor as Date;
      return {
        userId: user._id.toString(),
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        reference: user.deletionReference ?? null,
        reason: user.statusReason || null,
        requestedAt: new Date(scheduledFor.getTime() - GRACE_PERIOD_MS),
        scheduledFor,
        daysRemaining: Math.max(0, Math.ceil((scheduledFor.getTime() - now) / (24 * 60 * 60 * 1000))),
      };
    });

    return {
      requests,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  };

  adminCancelPendingDeletion = transaction.use(
    async (session: ClientSession, userId: string) => {
      const user = await User.findById(userId).session(session);

      if (!user || user.status !== "pending_deletion") {
        throw new NotFoundException(
          "No pending deletion request found for this account",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      user.status = "active";
      user.deletionScheduledFor = undefined;
      user.deletionType = undefined;
      user.deletionReference = undefined;
      user.statusReason = undefined;
      await user.save({ session });
    },
  );

  private applyFullDeletion = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      reference: string,
      reason?: string,
    ) => {
      const user = await User.findById(userId).session(session);
      if (!user) return;

      user.status = "pending_deletion";
      user.deletionScheduledFor = new Date(Date.now() + GRACE_PERIOD_MS);
      user.deletionReference = reference;
      user.refreshToken = "";
      user.refreshTokenExpiry = new Date(Date.now() - 1000);
      user.deletionSessionTokenHash = undefined;
      user.deletionSessionExpiresAt = undefined;
      if (reason) user.statusReason = reason;
      await user.save({ session });

      await Customer.findOneAndUpdate(
        { userId: user._id },
        { $set: { expoTokens: [] } },
        { session },
      );
    },
  );

  private applyEraseActivity = transaction.use(
    async (session: ClientSession, userId: string, reference: string) => {
      const user = await User.findById(userId).session(session);
      if (!user) return;

      await Address.deleteMany({ userId: user._id }).session(session);
      await Favourites.deleteOne({ customerId: user._id }).session(session);
      await Customer.findOneAndUpdate(
        { userId: user._id },
        { $unset: { addressId: "" }, $set: { profileImageUrl: "" } },
        { session },
      );
      await Cart.findOneAndUpdate(
        { customerId: user._id },
        { $set: { meals: [], totalAmount: 0 } },
        { session },
      );
      await this.stripCustomerOrders(user._id.toString(), session);

      user.deletionReference = reference;
      user.deletionSessionTokenHash = undefined;
      user.deletionSessionExpiresAt = undefined;
      await user.save({ session });
    },
  );

  // Called from AuthService.login, inside its own already-open transaction
  // session, before the status !== "active" rejection — this is the "sign
  // back in to cancel" promise from the review screen.
  reactivateIfPendingDeletion = async (
    user: UserDocument,
    session: ClientSession,
  ): Promise<boolean> => {
    if (user.status !== "pending_deletion") return false;
    if (!user.deletionScheduledFor || user.deletionScheduledFor <= new Date()) {
      return false;
    }

    user.status = "active";
    user.deletionScheduledFor = undefined;
    user.deletionType = undefined;
    user.deletionReference = undefined;
    user.statusReason = undefined;
    await user.save({ session });

    return true;
  };

  // Cron-only — see internal-cron.route.ts. Permanently anonymizes accounts
  // whose 30-day grace period has elapsed.
  hardDeleteDueAccounts = async (): Promise<{ processed: number }> => {
    const dueUsers = await User.find({
      status: "pending_deletion",
      deletionScheduledFor: { $lte: new Date() },
    });

    let processed = 0;
    for (const user of dueUsers) {
      await this.hardDeleteOne(user);
      processed += 1;
    }

    return { processed };
  };

  private hardDeleteOne = async (user: UserDocument) => {
    const reference = user.deletionReference ?? this.generateReference();

    // Sent before scrubbing — the email address is about to be destroyed.
    try {
      const htmlTemplate = await getTemplate(
        "src/templates",
        "delete-account-finalized.template.html",
      );
      const { template } = getFormattedData(htmlTemplate, user);
      const html = template.replaceAll("{{reference}}", reference);
      await mailer.relayTo(
        { user, message: html } as MailData,
        MailAction.deleteAccountFinalized,
      );
    } catch (error) {
      console.error("Failed to send final account-deletion email", {
        userId: user._id.toString(),
        message: (error as Error)?.message,
      });
    }

    await this.applyHardDelete(user._id.toString());
  };

  private applyHardDelete = transaction.use(
    async (session: ClientSession, userId: string) => {
      const user = await User.findById(userId).session(session);
      if (!user) return;

      await Address.deleteMany({ userId: user._id }).session(session);
      await Favourites.deleteOne({ customerId: user._id }).session(session);
      await Cart.findOneAndUpdate(
        { customerId: user._id },
        { $set: { meals: [], totalAmount: 0 } },
        { session },
      );
      await this.stripCustomerOrders(user._id.toString(), session);
      await Customer.findOneAndUpdate(
        { userId: user._id },
        { $unset: { addressId: "" }, $set: { profileImageUrl: "", expoTokens: [] } },
        { session },
      );

      user.email = `deleted-${user._id.toString()}@theotherwife.invalid`;
      user.firstName = "Deleted";
      user.lastName = "User";
      user.phoneNumber = undefined;
      user.passwordHash = crypto.randomBytes(32).toString("hex");
      user.status = "deleted";
      user.deletionScheduledFor = undefined;
      user.deletionType = undefined;
      user.refreshToken = "";
      user.refreshTokenExpiry = new Date(Date.now() - 1000);
      await user.save({ session });
    },
  );
}
