/** @format */

import type { NextFunction, Request, Response } from "express";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import { openSecret } from "../util/secret-box.util.js";
import {
  buildRequestSigningString,
  hmacSha256Hex,
  isTimestampFresh,
  parseSignatureHeader,
  safeEqualHex,
  SIGNATURE_TOLERANCE_SECONDS,
} from "../util/referral.util.js";

export const SIGNATURE_TIMESTAMP_HEADER = "tow-timestamp";
export const SIGNATURE_HEADER = "tow-signature";

const invalid = (message: string) =>
  new UnauthorizedExceptionError(
    message,
    HttpStatus.UNAUTHORIZED,
    ErrorCode.PARTNER_SIGNATURE_INVALID,
  );

// Optional HMAC-SHA256 request signing for partner API calls. Runs after
// partnerAuthMiddleware (the API key still authenticates; the signature adds
// integrity + freshness).
//
//   TOW-Timestamp: <unix seconds>
//   TOW-Signature: v1=<hex HMAC-SHA256(signingSecret, signingString)>
//
// signingString = timestamp \n METHOD \n path+query exactly as sent \n
//                 sha256-hex(raw body bytes, "" when no body)
//
// If the credential has requireSignature=true, unsigned or badly signed
// requests are rejected. Otherwise a signature is verified only when one is
// sent, so partners can test signing before it is enforced.
export const partnerSignatureMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const partner = req.partner;
    if (!partner) return next(invalid("Partner context missing"));

    const timestamp = req.get(SIGNATURE_TIMESTAMP_HEADER);
    const signatureHeader = req.get(SIGNATURE_HEADER);
    const signed = timestamp !== undefined || signatureHeader !== undefined;

    if (!signed) {
      return partner.requireSignature
        ? next(invalid("This API key requires signed requests (TOW-Timestamp and TOW-Signature headers)"))
        : next();
    }

    if (!partner.signingSecretCiphertext) {
      return next(invalid("No signing secret has been issued for this API key"));
    }
    if (!isTimestampFresh(timestamp)) {
      return next(
        invalid(`TOW-Timestamp is missing, malformed, or more than ${SIGNATURE_TOLERANCE_SECONDS} seconds from server time`),
      );
    }
    const candidates = parseSignatureHeader(signatureHeader);
    if (!candidates.length) {
      return next(invalid("TOW-Signature must be of the form v1=<64 hex characters>"));
    }

    const expected = hmacSha256Hex(
      openSecret(partner.signingSecretCiphertext),
      buildRequestSigningString({
        timestamp: timestamp as string,
        method: req.method,
        pathWithQuery: req.originalUrl,
        rawBody: req.rawBody ?? "",
      }),
    );

    if (!candidates.some((candidate) => safeEqualHex(candidate, expected))) {
      return next(invalid("Request signature does not match"));
    }
    next();
  } catch (error) {
    next(error);
  }
};
