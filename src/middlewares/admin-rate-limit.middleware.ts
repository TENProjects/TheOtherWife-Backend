/** @format */

import rateLimit from "express-rate-limit";

// Tighter than the app-wide limiter (100 req/15min) since admin routes carry
// elevated privileges (approve/reject vendors, change user status, move
// money via payouts) and are a higher-value target for brute-force/abuse.
export const adminRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  message: {
    status: "error",
    message: "Too many admin requests. Please try again later.",
  },
});

// Even tighter limit for the most sensitive mutations (creating a new admin
// account, changing a user's active/suspended status) — these should be rare,
// deliberate actions, not high-frequency traffic.
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
