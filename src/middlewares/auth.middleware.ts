/** @format */

import type { Request, Response, NextFunction } from "express";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

import { jwtSecret } from "../constants/env.js";

import { extractAccessToken, verifyToken } from "../util/generate-token.util.js";
import { UserDocument } from "../models/user.model.js";
import User from "../models/user.model.js";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const accessToken = extractAccessToken(req);

  if (!accessToken) {
    throw new UnauthorizedExceptionError(
      "Unauthorized. Please log in.",
      HttpStatus.UNAUTHORIZED,
      ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
    );
  }

  try {
    const decoded = verifyToken(accessToken, jwtSecret);

    if (!decoded || typeof decoded === "string") {
      throw new UnauthorizedExceptionError(
        `Unauthorized
        Reason: ${decoded}`,
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );
    }

    const user = await User.findById((decoded as UserDocument)._id).select(
      "-passwordHash",
    );

    if (!user)
      throw new UnauthorizedExceptionError(
        `Unauthorized
        Reason: User not found`,
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
      );

    if (user.status !== "active") {
      throw new UnauthorizedExceptionError(
        `Forbidden. User status is ${user.status}`,
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCESS_UNAUTHORIZED,
      );
    }

    req.user = user as unknown as UserDocument;
    next();
  } catch (error) {
    throw error;
  }
};
