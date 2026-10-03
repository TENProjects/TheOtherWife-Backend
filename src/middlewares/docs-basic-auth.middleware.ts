/** @format */

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";

import { HttpStatus } from "../config/http.config.js";
import { docsPassword, docsUsername } from "../constants/env.js";

const REALM = 'Basic realm="TOW API Docs", charset="UTF-8"';

// Hash both sides first so the comparison is constant-time regardless of
// input length.
const safeEqual = (a: string, b: string): boolean => {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
};

export const parseBasicAuth = (
  header: unknown,
): { username: string; password: string } | null => {
  if (typeof header !== "string") return null;
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
};

// Slows down password guessing. Only failed attempts count.
export const docsAuthRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: "Too many attempts. Please try again later.",
});

// Open only when NODE_ENV is explicitly "development" (local work). Read at
// request time, and deliberately NOT the defaulted nodeEnv constant — an
// unset NODE_ENV defaults to "development" there, which would leave a
// misconfigured server's docs open. Anything other than an explicit
// "development" (production, staging, test, unset) is locked.
const isExplicitDevelopment = () => process.env.NODE_ENV === "development";

// HTTP Basic protection for the full internal API documentation (/tow,
// /api-docs.json, /redoc) outside development. Fails closed: if
// DOCS_USERNAME or DOCS_PASSWORD is not configured, the docs are unavailable
// rather than public. The partner-only docs at /attribution/docs do not use
// this.
export const docsBasicAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.setHeader("Cache-Control", "no-store");

  if (isExplicitDevelopment()) {
    return next();
  }

  if (!docsUsername || !docsPassword) {
    return res
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .type("text/plain")
      .send("API documentation is disabled on this server.");
  }

  const credentials = parseBasicAuth(req.get("authorization"));
  const valid =
    !!credentials &&
    // Evaluate both comparisons so timing doesn't reveal which one failed.
    [
      safeEqual(credentials.username, docsUsername),
      safeEqual(credentials.password, docsPassword),
    ].every(Boolean);

  if (!valid) {
    res.setHeader("WWW-Authenticate", REALM);
    return res
      .status(HttpStatus.UNAUTHORIZED)
      .type("text/plain")
      .send("Authentication required.");
  }

  next();
};

export const protectInternalDocs = [
  docsAuthRateLimitMiddleware,
  docsBasicAuthMiddleware,
];
