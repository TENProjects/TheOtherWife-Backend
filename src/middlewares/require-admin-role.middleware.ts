/** @format */

import type { NextFunction, Request, Response } from "express";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

// Layers on top of roleGuardMiddleware(["admin"]) — never a replacement for
// it. A missing adminRole (every admin account created before this field
// existed) is treated as "super_admin", so no existing admin loses access
// anywhere this is newly applied.
export const requireAdminRole = (
  allowedRoles: Array<"super_admin" | "manager" | "support_agent">,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminRole = req.user?.adminRole ?? "super_admin";
      if (!allowedRoles.includes(adminRole as any)) {
        throw new UnauthorizedExceptionError(
          `Forbidden. The "${adminRole}" role is not allowed to access this resource`,
          HttpStatus.FORBIDDEN,
          ErrorCode.ACCESS_UNAUTHORIZED,
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
