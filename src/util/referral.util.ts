/** @format */

import crypto from "crypto";
import type { CostSharingMode } from "../models/referralCampaign.model.js";

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

// ── IP addresses (partner credential allow-lists) ───────────────────────

// Canonical form for comparing IPs: IPv4-mapped IPv6 ("::ffff:1.2.3.4") is
// reduced to plain IPv4, zone ids ("%eth0") are dropped, and IPv6 is
// compressed/lowercased via the WHATWG URL parser, so "2001:41D0:0701:1100:0:0:0:E31A"
// and "2001:41d0:701:1100::e31a" compare equal. Returns null if not an IP.
export const normalizeIp = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  let ip = raw.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) ip = mapped[1];

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255) ? parts.join(".") : null;
  }
  if (!ip.includes(":")) return null;
  try {
    const host = new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "");
    // The URL parser renders IPv4-mapped addresses in hex (::ffff:3983:8120).
    const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
    }
    return host;
  } catch {
    return null;
  }
};

export const ipAllowed = (requestIp: unknown, allowlist: string[]): boolean => {
  const ip = normalizeIp(requestIp);
  if (!ip) return false;
  return allowlist.some((entry) => normalizeIp(entry) === ip);
};

// ── HMAC signatures (partner request signing + outbound webhooks) ───────

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const hmacSha256Hex = (secret: string, message: string): string =>
  crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");

// Inbound partner request signing. One element per line:
//   <unix timestamp seconds>
//   <HTTP method, uppercase>
//   <path + query string exactly as sent, e.g. /api/v1/partner/homechefs?limit=50>
//   <lowercase hex SHA-256 of the raw request body bytes ("" when there is no body)>
export const buildRequestSigningString = (params: {
  timestamp: string;
  method: string;
  pathWithQuery: string;
  rawBody: string;
}): string =>
  [
    params.timestamp,
    params.method.toUpperCase(),
    params.pathWithQuery,
    sha256Hex(params.rawBody),
  ].join("\n");

// Outbound webhooks: HMAC-SHA256 over "<timestamp>.<raw JSON body>".
export const buildWebhookSigningString = (timestamp: string, rawBody: string): string =>
  `${timestamp}.${rawBody}`;

// Parses "v1=<hex>" (comma-separated list allowed; any matching v1 passes).
export const parseSignatureHeader = (header: unknown): string[] => {
  if (typeof header !== "string") return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).toLowerCase())
    .filter((hex) => /^[a-f0-9]{64}$/.test(hex));
};

export const isTimestampFresh = (
  timestamp: unknown,
  nowMs: number = Date.now(),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean => {
  if (typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(nowMs / 1000 - Number(timestamp)) <= toleranceSeconds;
};

// ── Weeks (Mon 00:00 – Sun 23:59:59.999 WAT) ────────────────────────────
//
// West Africa Time is UTC+1 all year (no DST), so a WAT week is a fixed
// UTC interval: Monday 00:00 WAT = Sunday 23:00 UTC.

export const WAT_OFFSET_MS = 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// The UTC instant at which the WAT week containing `at` starts.
export const watWeekStart = (at: Date): Date => {
  const local = new Date(at.getTime() + WAT_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysSinceMonday,
  );
  return new Date(midnightLocal - WAT_OFFSET_MS);
};

// "YYYY-MM-DD" (a Monday, in WAT) → week start instant; null if invalid or
// not a Monday.
export const parseWatWeekStart = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const localMidnight = Date.UTC(y, m - 1, d);
  const check = new Date(localMidnight);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  if (check.getUTCDay() !== 1) return null;
  return new Date(localMidnight - WAT_OFFSET_MS);
};

// Week start instant → its WAT calendar date "YYYY-MM-DD".
export const formatWatDate = (at: Date): string =>
  new Date(at.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);

const watMonthKey = (at: Date): string =>
  new Date(at.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 7);

const daysInMonth = (monthKey: string): number => {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// Platform cost attributable to [start, end): each WAT day costs
// (that month's amount ÷ days in that month). Months without an entry are
// reported in missingMonths (and contribute 0).
export const platformCostForRange = (
  start: Date,
  end: Date,
  monthlyAmounts: Map<string, number>,
): { cost: number; missingMonths: string[] } => {
  let cost = 0;
  const missing = new Set<string>();
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    const month = watMonthKey(new Date(t));
    const amount = monthlyAmounts.get(month);
    if (amount === undefined) {
      missing.add(month);
      continue;
    }
    cost += amount / daysInMonth(month);
  }
  return { cost, missingMonths: Array.from(missing).sort() };
};

export const monthsInRange = (start: Date, end: Date): string[] => {
  const months = new Set<string>();
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    months.add(watMonthKey(new Date(t)));
  }
  return Array.from(months).sort();
};

// ── Money ────────────────────────────────────────────────────────────────

export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

// TOW's earned amount on one order (agreed definition): the 20% platform fee
// on the food subtotal + the service charge − the Paystack fee TOW absorbs.
// VAT (taxAmount) is excluded — it is owed to the government. Can be
// negative on very small orders; kept as-is so totals stay truthful.
export const towEarnedOnOrder = (parts: {
  platformFee: number;
  serviceCharge: number;
  paystackFee: number;
}): number =>
  (parts.platformFee || 0) + (parts.serviceCharge || 0) - (parts.paystackFee || 0);

// Weekly partner payout:
//   share          = partnerEarned × sharePercent / 100
//   allocatedCost  = periodCost × clamp(partnerEarned ÷ totalEarned, 0..1)
//                    (the platform cost attributable to the partner's orders)
//   costDeducted   = partner_absorbs: allocatedCost (partner bears all of it)
//                    proportional:    allocatedCost × sharePercent / 100, so
//                    payout = sharePercent × (partnerEarned − allocatedCost),
//                    a true profit split
//   net            = share − costDeducted + adjustments (negative = owed back)
//   payout         = max(0, net); a negative net is carried forward.
export const computePartnerPayout = (params: {
  partnerEarned: number;
  totalEarned: number;
  sharePercent: number;
  periodCost: number;
  deductPlatformCost: boolean;
  adjustmentsTotal: number;
  costSharing?: CostSharingMode;
}) => {
  const costSharing: CostSharingMode = params.costSharing ?? "partner_absorbs";
  const share = (params.partnerEarned * params.sharePercent) / 100;
  const costShare =
    params.deductPlatformCost && params.totalEarned > 0
      ? Math.min(Math.max(params.partnerEarned / params.totalEarned, 0), 1)
      : 0;
  const allocatedCost = params.periodCost * costShare;
  const costDeducted =
    costSharing === "proportional" ? (allocatedCost * params.sharePercent) / 100 : allocatedCost;
  const net = share - costDeducted + params.adjustmentsTotal;
  return {
    partnerEarned: roundMoney(params.partnerEarned),
    totalEarned: roundMoney(params.totalEarned),
    share: roundMoney(share),
    costSharePercent: roundMoney(costShare * 100),
    periodCost: roundMoney(params.periodCost),
    allocatedCost: roundMoney(allocatedCost),
    costDeducted: roundMoney(costDeducted),
    adjustmentsTotal: roundMoney(params.adjustmentsTotal),
    net: roundMoney(net),
    payout: roundMoney(Math.max(0, net)),
    carryForward: roundMoney(Math.min(0, net)),
  };
};

// HomeChef batch n covers ranks [(n−1)·size + 1, n·size], within the cap.
export const homechefBatchRange = (batchNumber: number, batchSize: number, cap: number) => {
  const from = (batchNumber - 1) * batchSize + 1;
  const to = Math.min(batchNumber * batchSize, cap);
  return { from, to, size: Math.max(0, to - from + 1) };
};

export const homechefBatchCount = (batchSize: number, cap: number): number =>
  batchSize > 0 ? Math.ceil(cap / batchSize) : 0;
