/** @format */

import rateLimit from "express-rate-limit";

// Tighter than the app-wide limiter — applied only to credential-guessing-
// relevant endpoints (signup, login, google, password reset/change,
// verification resend). This is the limiter that actually matters for
// brute-force/credential-stuffing/account-enumeration protection; the
// app-wide one is too loose to do that job on its own and, before this,
// was the only thing standing in the way.
export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  message: {
    status: "error",
    message: "Too many attempts. Please try again later.",
  },
});
