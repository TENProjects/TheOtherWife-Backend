/** @format */

import type { NextFunction, Request, Response } from "express";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";

import Partner from "../models/partner.model.js";
import PartnerCredential, {
  PartnerScope,
} from "../models/partnerCredential.model.js";
import {
  ipAllowed,
  parsePartnerApiKey,
  safeEqualHex,
  sha256Hex,
} from "../util/referral.util.js";

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// Lookups isolated behind a tiny object so tests can stub them without a DB.
export const partnerCredentialStore = {
  findByKeyId: (keyId: string) =>
    PartnerCredential.findOne({ keyId })
      .select("+secretHash +signingSecretCiphertext")
      .lean(),
  isPartnerActive: async (partnerId: unknown) => {
    const partner = await Partner.findById(partnerId).select("status").lean();
    return partner?.status === "active";
  },
  touch: (credentialId: unknown) =>
    PartnerCredential.updateOne(
      { _id: credentialId },
      { $set: { lastUsedAt: new Date() } },
    ),
};

const unauthorized = () =>
  new UnauthorizedExceptionError(
    "Invalid or missing partner credentials",
    HttpStatus.UNAUTHORIZED,
    ErrorCode.PARTNER_UNAUTHORIZED,
  );

// Authenticates partner API requests ONLY. Uses the Authorization header,
// which TOW's user authMiddleware never reads (that one is cookie-only), so a
// partner key is inert on every non-partner route, and a user cookie is
// ignored here. Sets req.partner — never req.user. Every failure mode returns
// the same generic 401 so callers can't distinguish unknown/revoked/expired
// keys.
export const partnerAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = parsePartnerApiKey(req.get("authorization"));
    if (!parsed) throw unauthorized();

    const credential = await partnerCredentialStore.findByKeyId(parsed.keyId);
    if (!credential) throw unauthorized();

    const secretMatches = safeEqualHex(
      sha256Hex(parsed.secret),
      (credential as { secretHash?: string }).secretHash ?? "",
    );
    if (!secretMatches) throw unauthorized();

    if (credential.status !== "active") throw unauthorized();
    if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= Date.now()) {
      throw unauthorized();
    }
    if (
      Array.isArray(credential.ipAllowlist) &&
      credential.ipAllowlist.length > 0 &&
      !ipAllowed(req.ip, credential.ipAllowlist)
    ) {
      throw unauthorized();
    }
    if (!(await partnerCredentialStore.isPartnerActive(credential.partnerId))) {
      throw unauthorized();
    }

    req.partner = {
      partnerId: credential.partnerId as any,
      credentialId: credential._id as any,
      keyId: credential.keyId,
      scopes: [...(credential.scopes ?? [])],
      requireSignature: credential.requireSignature === true,
      signingSecretCiphertext: (credential as { signingSecretCiphertext?: string })
        .signingSecretCiphertext,
    };

    const lastUsed = credential.lastUsedAt ? new Date(credential.lastUsedAt).getTime() : 0;
    if (Date.now() - lastUsed > LAST_USED_WRITE_INTERVAL_MS) {
      Promise.resolve(partnerCredentialStore.touch(credential._id)).catch((error) =>
        console.error("Failed to update partner credential lastUsedAt", error),
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Must run after partnerAuthMiddleware. One explicit scope per route.
export const requirePartnerScope = (scope: PartnerScope) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.partner) {
      return next(unauthorized());
    }
    if (!req.partner.scopes.includes(scope)) {
      return next(
        new UnauthorizedExceptionError(
          `This credential does not have the "${scope}" scope`,
          HttpStatus.FORBIDDEN,
          ErrorCode.PARTNER_FORBIDDEN_SCOPE,
        ),
      );
    }
    next();
  };
};
