/** @format */

import z from "zod";
import type { NextFunction, Request, Response } from "express";
import User from "../models/user.model.js";

export const zodValidation =
  (schema: z.ZodType<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // A client that sends no body at all (no Content-Type, no payload)
      // leaves req.body as undefined rather than {} — body-parser only
      // populates req.body when it actually parses something. Schemas for
      // "fully optional body" routes are still required z.object({...})
      // shapes, so parsing undefined directly would always fail even
      // though an empty body is valid for them.
      const value = schema.parse(req.body ?? {});
      req.body = Object.assign(req.body ?? {}, value);
      next();
    } catch (error) {
      throw error;
    }
  };
