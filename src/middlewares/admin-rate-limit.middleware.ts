/** @format */

import type { Request } from "express";
import rateLimit from "express-rate-limit";

// This one middleware instance is imported by every admin route file (20+
// at last count), so its counter is shared across the entire admin API
// surface, not per-route — a single admin session paging through the
// dashboard (Super Admin's ~9 tabs, Orders, Vendors, Customers, Financials,
// each refetching on tab focus via RTK Query) adds up fast. Keyed by the
// authenticated admin's user id (authMiddleware always runs first in these
// route chains, so req.user is already populated) rather than IP, so admins
// sharing an office/VPN address don't share one budget, and the limit
// actually tracks per-account usage the way it's meant to. Falls back to IP
// only as a defensive default in case this is ever reached pre-auth.
const keyByAdminId = (req: Request): string =>
  req.user?._id?.toString() ?? req.ip ?? "unknown";

// Tighter than the app-wide limiter (500 req/15min) since admin routes carry
// elevated privileges (approve/reject vendors, change user status, move
// money via payouts) and are a higher-value target for brute-force/abuse —
// but still generous enough for normal dashboard browsing, which is a lot
// chattier than a typical authenticated user session.
export const adminRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByAdminId,
  validate: {
    xForwardedForHeader: false,
  },
  message: {
    status: "error",
    message: "Too many admin requests. Please try again later.",
  },
});

export const adminSensitiveActionRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  message: {
    status: "error",
    message: "Too many sensitive admin actions. Please try again later.",
  },
});
