/** @format */

import type { NextFunction, Request, Response } from "express";

// Query strings and route params are only ever meant to carry flat
// scalars/arrays of scalars. Express's query parser turns bracket syntax
// (e.g. "?status[$ne]=x") into a nested object, which — if a controller
// passes that value straight into a Mongoose filter (a common, previously
// unvalidated pattern here, since zodValidation only checks req.body) —
// lets an attacker inject a real Mongo operator instead of a plain value.
// This strips any query/param value that isn't a plain scalar (or an array
// of plain scalars) before it ever reaches a controller, closing that whole
// class of NoSQL injection at the door rather than requiring every
// individual req.query usage to be audited and fixed by hand.
const isPlainScalar = (value: unknown): boolean =>
  value === null || typeof value !== "object";

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.every(isPlainScalar) ? value : undefined;
  }
  if (value !== null && typeof value === "object") {
    return undefined;
  }
  return value;
};

export const sanitizeQueryAndParams = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  for (const key of Object.keys(req.query)) {
    (req.query as Record<string, unknown>)[key] = sanitizeValue(
      (req.query as Record<string, unknown>)[key],
    );
  }
  for (const key of Object.keys(req.params)) {
    (req.params as Record<string, unknown>)[key] = sanitizeValue(
      (req.params as Record<string, unknown>)[key],
    );
  }
  next();
};
