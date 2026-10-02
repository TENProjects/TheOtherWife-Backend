/** @format */

import type { NextFunction, Request, Response } from "express";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";

import PartnerIdempotencyKey from "../models/partnerIdempotencyKey.model.js";
import { hashPayload } from "../util/referral.util.js";

const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

// Server-side Idempotency-Key handling for partner write requests. Must run
// after partnerAuthMiddleware (keys are scoped per partner).
//
//  - First request with a key: claims the key (unique index = lock), runs the
//    handler, stores the final status + body.
//  - Same key + same request: the stored response is replayed verbatim
//    (header Idempotent-Replayed: true).
//  - Same key + different request: 422 IDEMPOTENCY_KEY_REUSED.
//  - Same key while the first is still running: 409 IDEMPOTENCY_IN_PROGRESS.
//  - 5xx responses are not stored, so the client can safely retry.
//
// This complements (does not replace) the natural-key uniqueness on
// (partnerId, type, externalRef) enforced by the service and database.
export const partnerIdempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.partner) {
      throw new AppError(
        "Partner context missing",
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    const key = req.get("idempotency-key");
    if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        "A valid Idempotency-Key header (8-128 chars: A-Z a-z 0-9 _ - : .) is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      );
    }

    const path = req.baseUrl + req.path;
    const requestHash = hashPayload({ method: req.method, path, body: req.body ?? {} });
    const partnerId = req.partner.partnerId;

    let record;
    try {
      record = await PartnerIdempotencyKey.create({
        partnerId,
        key,
        method: req.method,
        path,
        requestHash,
        state: "in_progress",
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;

      const existing = await PartnerIdempotencyKey.findOne({ partnerId, key });
      if (!existing) {
        throw new AppError(
          "Idempotency key is being processed, retry shortly",
          HttpStatus.CONFLICT,
          ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        );
      }
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          "Idempotency-Key was already used with a different request",
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
        );
      }
      if (existing.state !== "completed") {
        throw new AppError(
          "A request with this Idempotency-Key is still being processed",
          HttpStatus.CONFLICT,
          ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        );
      }
      res.setHeader("Idempotent-Replayed", "true");
      return res.status(existing.responseStatus ?? 200).json(existing.responseBody);
    }

    const originalJson = res.json.bind(res);
    let settled = false;
    res.json = ((body: unknown) => {
      if (!settled) {
        settled = true;
        const status = res.statusCode;
        const persist =
          status >= 500
            ? PartnerIdempotencyKey.deleteOne({ _id: record._id })
            : PartnerIdempotencyKey.updateOne(
                { _id: record._id },
                {
                  $set: {
                    state: "completed",
                    responseStatus: status,
                    responseBody: body,
                  },
                },
              );
        persist.catch((persistError: unknown) =>
          console.error("Failed to persist idempotency record", persistError),
        );
      }
      return originalJson(body);
    }) as Response["json"];

    // If the connection drops before any JSON is written, release the key so
    // a retry isn't stuck behind a permanent "in_progress".
    res.on("close", () => {
      if (!settled) {
        settled = true;
        PartnerIdempotencyKey.deleteOne({ _id: record._id }).catch(() => undefined);
      }
    });

    next();
  } catch (error) {
    next(error);
  }
};
