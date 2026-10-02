/** @format */

import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Per-credential budget for the partner API, keyed by the authenticated
// partner keyId (partnerAuthMiddleware always runs first). Applied in
// addition to — not instead of — the app-wide per-IP limiter in app.ts.
export const partnerRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string =>
    req.partner?.keyId
      ? `partner:${req.partner.keyId}`
      : req.ip
        ? ipKeyGenerator(req.ip)
        : "unknown",
  validate: {
    xForwardedForHeader: false,
  },
  message: {
    status: "error",
    message: "Too many partner API requests. Please try again later.",
  },
});
