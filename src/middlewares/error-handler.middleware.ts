/** @format */

import z from "zod";
import jwt from "jsonwebtoken";

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
