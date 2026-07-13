/** @format */

import type { NextFunction, Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { cronSecret } from "../constants/env.js";

// Guards internal endpoints meant only for Vercel Cron (or another trusted
// scheduler) to call — never a logged-in user. Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` on cron-triggered requests when a
// `CRON_SECRET` env var is configured on the project, so this only needs to
// compare that header against the same secret.
export const cronAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!cronSecret) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: "error",
      message: "CRON_SECRET is not configured on this server",
    });
  }

  const authHeader = req.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(HttpStatus.UNAUTHORIZED).json({
      status: "error",
      message: "Unauthorized",
    });
  }

  return next();
};
