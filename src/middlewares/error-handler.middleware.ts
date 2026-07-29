/** @format */

import z from "zod";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      message: err.message,
      error: err.errorCode,
      status: "error",
    });
  }

  if (err instanceof z.ZodError) {
    return res.status(HttpStatus.BAD_REQUEST).json({
      message: "Validation error",
      error: err.issues,
      status: "error",
    });
  }

  // Many services pass a route param straight into Model.findById/findOne
  // without checking it's a valid ObjectId first (24-hex) — an arbitrary
  // string there throws mongoose's own CastError, which isn't an AppError
  // and would otherwise fall through to the generic 500 below on every
  // such route. This is the one place that safety net needs to exist for
  // it to cover routes that don't (or forget to) validate the id
  // themselves, rather than requiring every call site to remember to.
  if (err instanceof mongoose.Error.CastError && err.kind === "ObjectId") {
    return res.status(HttpStatus.BAD_REQUEST).json({
      message: `Invalid ${err.path}`,
      error: ErrorCode.VALIDATION_ERROR,
      status: "error",
    });
  }

  // express.json() throws these via the `http-errors` package for a
  // malformed request body (bad JSON syntax) or one over the size limit —
  // both are the client's fault, not ours, but neither is an AppError, so
  // without this they'd fall through to the generic 500 below. http-errors
  // always sets a proper 4xx `status`/`statusCode`; trust it instead of
  // guessing from `err.type`.
  const bodyParserStatus = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;
  if (typeof bodyParserStatus === "number" && bodyParserStatus >= 400 && bodyParserStatus < 500) {
    return res.status(bodyParserStatus).json({
      message: bodyParserStatus === 413 ? "Request body is too large" : "Malformed request body",
      error: ErrorCode.VALIDATION_ERROR,
      status: "error",
    });
  }

  // jsonwebtoken throws its own error classes (not AppError) when a token is
  // expired/malformed/not-yet-valid. Without this branch these fall through
  // to the generic 500 below — and since authMiddleware runs on every
  // protected route, an expired session would 500 on every single request
  // instead of cleanly prompting a re-login.
  if (
    err instanceof jwt.TokenExpiredError ||
    err instanceof jwt.JsonWebTokenError ||
    err instanceof jwt.NotBeforeError
  ) {
    return res.status(HttpStatus.UNAUTHORIZED).json({
      message: err instanceof jwt.TokenExpiredError ? "jwt expired" : "jwt malformed",
      error: ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      status: "error",
    });
  }

  if (err instanceof Error) {
    console.error("Unhandled error:", err);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server error",
      error: "Something went wrong. Please try again.",
      status: "error",
    });
  }

  return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
    message: "Unknown error",
    error: "Unknown error occurred",
    status: "error",
  });
};
