/** @format */

import type { NextFunction, Request, Response } from "express";
import { jwtSecret } from "../constants/env.js";
import { verifyToken } from "../util/generate-token.util.js";
import { UserDocument } from "../models/user.model.js";
import User from "../models/user.model.js";

export const optionalAuthMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const accessToken = req.cookies?.token;

  if (!accessToken) {
    next();
    return;
  }

  try {
    const decoded = verifyToken(accessToken, jwtSecret);

    if (!decoded || typeof decoded === "string") {
      next();
      return;
    }

    const user = await User.findById((decoded as UserDocument)._id).select(
      "-passwordHash",
    );

    if (!user || user.status !== "active") {
      next();
      return;
    }

    req.user = user as unknown as UserDocument;
    next();
  } catch (_error) {
    next();
  }
};
