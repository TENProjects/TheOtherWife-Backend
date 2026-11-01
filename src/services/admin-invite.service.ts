/** @format */

import crypto from "crypto";
import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { frontendUrl } from "../constants/env.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import User from "../models/user.model.js";
import { getTemplate } from "../util/get-template.util.js";
import { mailer } from "./email.service.js";

/**
 * Admin invitations.
 *
 * A super admin invites a person by name, email, phone and role. No password
 * is set or seen by anyone but the invitee:
 *  - the account is created with a random, unknowable password and cannot
 *    sign in (login also refuses any account with a pending invite)
 *  - a single-use link (32 random bytes) is emailed; only its SHA-256 is
 *    stored, so a database leak does not leak working links
 *  - the link expires after INVITE_TTL_HOURS; resending replaces it, so only
 *    the newest link ever works
 *  - accepting claims the token atomically (one use, even under a race),
 *    sets the invitee's own password under PASSWORD_POLICY, and verifies
 *    their email in the same step (they proved control of the inbox)
 */

export const INVITE_TTL_HOURS = 48;
export const ADMIN_ROLES = ["super_admin", "manager", "support_agent"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  manager: "Manager",
  support_agent: "Support Agent",
};

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
const badRequest = (message: string, code: ErrorCodeValue = ErrorCode.VALIDATION_ERROR) =>
  new BadRequestException(message, HttpStatus.BAD_REQUEST, code);

const INVALID_LINK = "This invitation link is invalid or has expired. Ask a super admin to resend it.";

/**
 * Strong password rule for admin accounts (they can move money):
 * at least 12 characters, three of upper/lower/number/symbol, no spaces at
 * the ends, and not built from the person's own name or email.
 */
export function passwordProblem(password: string, person: { email: string; firstName: string; lastName: string }): string | null {
  if (typeof password !== "string" || password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  if (password !== password.trim()) return "Remove spaces at the start or end.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) return "Mix at least three of: lowercase, uppercase, numbers and symbols.";
  const lower = password.toLowerCase();
  const personal = [person.email.split("@")[0], person.firstName, person.lastName]
    .map((s) => (s ?? "").toLowerCase())
    .filter((s) => s.length >= 3);
  if (personal.some((s) => lower.includes(s))) return "Don't use your name or email in your password.";
  return null;
}

export class AdminInviteService {
  /** Builds and sends the email. Returns true only when the email provider accepted it. */
  private sendInviteEmail = async (
    user: { _id: unknown; email: string; firstName: string; adminRole?: AdminRole },
    rawToken: string,
    inviterName: string,
  ): Promise<boolean> => {
    const template = await getTemplate("src/templates", "admin-invite.template.html");
    const inviteUrl = `${frontendUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    const html = template
      .replaceAll("{{firstName}}", escapeHtml(user.firstName))
      .replaceAll("{{inviterName}}", escapeHtml(inviterName))
      .replaceAll("{{roleLabel}}", ROLE_LABEL[user.adminRole ?? "support_agent"])
      .replaceAll("{{inviteUrl}}", inviteUrl)
      .replaceAll("{{expiresHours}}", String(INVITE_TTL_HOURS));

    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await mailer.sendSystemAlert(user.email, "Activate your TheOtherWife admin account", html);
        await User.updateOne(
          { _id: user._id },
          { $set: { adminInviteEmailStatus: "sent", adminInviteEmailLastAttemptAt: new Date() }, $unset: { adminInviteEmailError: 1 } },
        );
        return true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        // Permanent rejections (bad address, unverified domain) will not succeed on retry.
        const status = Number(/\((\d{3})\)/.exec(lastError)?.[1]);
        if (status >= 400 && status < 500 && status !== 429) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    console.error(`[admin-invite] email to ${user.email} failed: ${lastError}`);
    await User.updateOne(
      { _id: user._id },
      { $set: { adminInviteEmailStatus: "failed", adminInviteEmailLastAttemptAt: new Date(), adminInviteEmailError: lastError.slice(0, 500) } },
    );
    return false;
  };

  private newToken = () => {
    const raw = crypto.randomBytes(32).toString("base64url");
    return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000) };
  };

  invite = async (
    input: { firstName: string; lastName: string; email: string; phoneNumber: string; adminRole: AdminRole },
    inviter: { id: string; name: string },
  ) => {
    const email = input.email.trim().toLowerCase();
    const existing = await User.findOne({ $or: [{ email }, { phoneNumber: input.phoneNumber }] }).select("email").lean();
    if (existing) {
      throw badRequest("An account with this email or phone number already exists", ErrorCode.AUTH_USER_ALREADY_EXISTS);
    }

    const token = this.newToken();
    let user;
    try {
      user = await User.create({
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email,
        phoneNumber: input.phoneNumber,
        // Random and never shown to anyone: the account is unusable until the invite is accepted.
        passwordHash: crypto.randomBytes(48).toString("base64url"),
        userType: "admin",
        adminRole: input.adminRole,
        authType: "email",
        status: "active",
        isEmailVerified: false,
        adminInviteTokenHash: token.hash,
        adminInviteExpiresAt: token.expiresAt,
        adminInvitedBy: new mongoose.Types.ObjectId(inviter.id),
        adminInviteEmailStatus: "pending",
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw badRequest("An account with this email or phone number already exists", ErrorCode.AUTH_USER_ALREADY_EXISTS);
      }
      throw error;
    }

    const emailSent = await this.sendInviteEmail(user, token.raw, inviter.name);
    return { userId: String(user._id), email, adminRole: input.adminRole, emailSent, expiresAt: token.expiresAt };
  };

  /** New link for a pending invite. The previous link stops working at once. */
  resend = async (userId: string, inviter: { name: string }) => {
    if (!mongoose.isValidObjectId(userId)) throw badRequest("Invalid user id");
    const token = this.newToken();
    const user = await User.findOneAndUpdate(
      { _id: userId, userType: "admin", adminInviteAcceptedAt: { $exists: false }, isEmailVerified: false },
      { $set: { adminInviteTokenHash: token.hash, adminInviteExpiresAt: token.expiresAt, adminInviteEmailStatus: "pending" } },
      { new: true },
    );
    if (!user) {
      throw new NotFoundException("No pending invitation for this admin", HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);
    }
    const emailSent = await this.sendInviteEmail(user, token.raw, inviter.name);
    return { userId, email: user.email, emailSent, expiresAt: token.expiresAt };
  };

  /** For the activation page: who the link is for, without revealing the full email. */
  check = async (rawToken: string) => {
    const user = await this.findPending(rawToken);
    const [local, domain] = user.email.split("@");
    return {
      firstName: user.firstName,
      emailHint: `${local.slice(0, 2)}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`,
      adminRole: user.adminRole ?? "support_agent",
      expiresAt: user.adminInviteExpiresAt,
    };
  };

  accept = async (rawToken: string, password: string) => {
    const pending = await this.findPending(rawToken);
    const problem = passwordProblem(password, pending);
    if (problem) throw badRequest(problem);

    // Claim the token atomically: of two simultaneous submissions, only one wins.
    const claimed = await User.findOneAndUpdate(
      { _id: pending._id, adminInviteTokenHash: sha256(rawToken), adminInviteExpiresAt: { $gt: new Date() } },
      { $unset: { adminInviteTokenHash: 1 }, $set: { adminInviteAcceptedAt: new Date() } },
      { new: true },
    );
    if (!claimed) throw badRequest(INVALID_LINK, ErrorCode.AUTH_INVALID_TOKEN);

    claimed.passwordHash = password; // hashed with bcrypt by the model's pre-save hook
    claimed.passwordChangedAt = new Date();
    claimed.isEmailVerified = true;
    claimed.adminInviteExpiresAt = new Date(Date.now() - 1000);
    claimed.refreshToken = "";
    await claimed.save();
    return { email: claimed.email };
  };

  private findPending = async (rawToken: string) => {
    if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 100) {
      throw badRequest(INVALID_LINK, ErrorCode.AUTH_INVALID_TOKEN);
    }
    const user = await User.findOne({
      adminInviteTokenHash: sha256(rawToken),
      adminInviteExpiresAt: { $gt: new Date() },
      userType: "admin",
    });
    if (!user) throw badRequest(INVALID_LINK, ErrorCode.AUTH_INVALID_TOKEN);
    return user;
  };
}

export const adminInviteService = new AdminInviteService();
