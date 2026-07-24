/** @format */

import z from "zod";

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app.error.js";
import { HttpStatus } from "../config/http.config.js";

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
