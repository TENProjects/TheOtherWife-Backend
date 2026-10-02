/** @format */

import crypto from "crypto";

// Pure helpers for the referral/attribution core and the partner API. Kept
// free of any database access so they can be unit-tested in isolation.

export const DAY_MS = 24 * 60 * 60 * 1000;

// ── Referral codes ──────────────────────────────────────────────────────

// Ambiguous characters (0/O, 1/I/L) are excluded from generated codes so a
// code read aloud or copied from a flyer can't be mistyped into a different
// valid code. Admin-chosen vanity codes may use any A-Z/0-9 plus "-".
const GENERATED_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GENERATED_CODE_LENGTH = 8;

// 4–32 chars, uppercase alphanumerics and single inner hyphens.
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{2,30})[A-Z0-9]$/;

export const normalizeReferralCode = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!REFERRAL_CODE_PATTERN.test(code) || code.includes("--")) return null;
  return code;
};

export const generateReferralCode = (
  length: number = GENERATED_CODE_LENGTH,
): string => {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += GENERATED_CODE_ALPHABET[bytes[i] % GENERATED_CODE_ALPHABET.length];
  }
  return code;
};

// ── Hashing / secrets ───────────────────────────────────────────────────

export const sha256Hex = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

// Constant-time comparison of two hex digests (same pattern as the Paystack
// webhook signature check in payment.service.ts).
export const safeEqualHex = (a: string, b: string): boolean => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

// Deterministic JSON serialization (sorted object keys) so the same logical
// payload always hashes the same regardless of key order.
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(",")}}`;
};

export const hashPayload = (value: unknown): string =>
  sha256Hex(stableStringify(value));

// ── Partner API keys ────────────────────────────────────────────────────
//
// Format: tow_pk_<keyId>.<secret>
//   keyId  — 16 lowercase hex chars, public, stored in clear, used for lookup
//   secret — 43 base64url chars (32 random bytes), only its SHA-256 is stored
//
// The full key is shown exactly once, at issue time.

export const PARTNER_KEY_PREFIX = "tow_pk_";
const PARTNER_KEY_PATTERN = /^tow_pk_([a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/;

export const generatePartnerApiKey = () => {
  const keyId = crypto.randomBytes(8).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return {
    keyId,
    apiKey: `${PARTNER_KEY_PREFIX}${keyId}.${secret}`,
    secretHash: sha256Hex(secret),
  };
};

export const parsePartnerApiKey = (
  authorizationHeader: unknown,
): { keyId: string; secret: string } | null => {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.match(/^Bearer\s+(\S+)$/);
  if (!match) return null;
  const keyMatch = match[1].match(PARTNER_KEY_PATTERN);
  if (!keyMatch) return null;
  return { keyId: keyMatch[1], secret: keyMatch[2] };
};

// ── Opaque public identifiers / invite tokens ───────────────────────────

export const generatePublicId = (prefix: string): string =>
  `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

export const generateInviteToken = () => {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
};

// ── Attribution windows ─────────────────────────────────────────────────

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS);

// Half-open interval [start, end). A missing end means "no expiry".
export const isWithinWindow = (
  at: Date,
  start: Date,
  end?: Date | null,
): boolean => {
  const t = at.getTime();
  if (t < start.getTime()) return false;
  if (end && t >= end.getTime()) return false;
  return true;
};

export type AttributionLiveState = "active" | "expired" | "revoked";

export const attributionLiveState = (
  attribution: { status: string; expiresAt?: Date | null },
  now: Date = new Date(),
): AttributionLiveState => {
  if (attribution.status === "revoked") return "revoked";
  if (attribution.expiresAt && now.getTime() >= attribution.expiresAt.getTime()) {
    return "expired";
  }
  return "active";
};

// ── Vendor lifecycle classification ─────────────────────────────────────
//
// Maps the EXISTING Vendor fields (approvalStatus, inspectionStatus,
// additionalData.onboarding.submittedAt) onto reporting buckets without
// changing or re-interpreting the lifecycle itself. "pending" in the Vendor
// model covers both an incomplete onboarding and a submitted application
// awaiting review — submittedAt is what tells them apart.

export type VendorLifecycleBucket =
  | "deleted"
  | "onboarding_incomplete"
  | "pending_review"
  | "approved"
  | "rejected"
  | "suspended";

export type VendorLifecycleSnapshot = {
  approvalStatus?: string;
  inspectionStatus?: string;
  approvedAt?: Date | null;
  additionalData?: unknown;
} | null;

export const getVendorSubmittedAt = (
  vendor: VendorLifecycleSnapshot,
): string | null => {
  const additional = (vendor?.additionalData ?? {}) as Record<string, any>;
  const submittedAt = additional?.onboarding?.submittedAt;
  return typeof submittedAt === "string" && submittedAt ? submittedAt : null;
};

export const classifyVendorLifecycle = (
  vendor: VendorLifecycleSnapshot,
): VendorLifecycleBucket => {
  if (!vendor) return "deleted";
  switch (vendor.approvalStatus) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "suspended":
      return "suspended";
    default:
      return getVendorSubmittedAt(vendor) ? "pending_review" : "onboarding_incomplete";
  }
};

// External (partner-facing) status for a submission. Deliberately coarse —
// no rejection reasons, KYC, bank or internal ids are ever derived here.
export type PartnerSubmissionExternalStatus =
  | "submitted"
  | "expired"
  | "registered"
  | "pending_review"
  | "inspected"
  | "approved"
  | "rejected"
  | "suspended"
  | "closed";

export const derivePartnerSubmissionStatus = (params: {
  type: "homechef" | "customer";
  linked: boolean;
  campaignEndsAt?: Date | null;
  vendor?: VendorLifecycleSnapshot;
  userExists?: boolean;
  now?: Date;
}): PartnerSubmissionExternalStatus => {
  const now = params.now ?? new Date();
  if (!params.linked) {
    if (params.campaignEndsAt && now.getTime() >= params.campaignEndsAt.getTime()) {
      return "expired";
    }
    return "submitted";
  }

  if (params.type === "customer") {
    return params.userExists === false ? "closed" : "registered";
  }

  const bucket = classifyVendorLifecycle(params.vendor ?? null);
  switch (bucket) {
    case "deleted":
      return "closed";
    case "onboarding_incomplete":
      return "registered";
    case "pending_review":
      return params.vendor?.inspectionStatus === "completed"
        ? "inspected"
        : "pending_review";
    default:
      return bucket;
  }
};

// ── CSV ─────────────────────────────────────────────────────────────────

// RFC4180 — same escaping rule as home-chef-application.service.ts. Also
// neutralises spreadsheet formula injection for values starting with
// = + - @ (partner-supplied strings end up in admin CSV exports).
export const csvEscape = (value: unknown): string => {
  let str = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};
