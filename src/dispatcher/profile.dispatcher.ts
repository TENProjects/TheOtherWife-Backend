/** @format */

import type { ClientSession } from "mongoose";

import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";

export const CreateProfile = {
  customer: (userId: string, session: ClientSession) =>
    Customer.create([{ userId }], { session }),
  vendor: (userId: string, session: ClientSession) =>
    Vendor.create([{ userId }], { session }),
  // Admins have no separate profile sub-document (see user.model.ts — userType
  // is a flat enum, not a linked profile like Customer/Vendor). Public signup
  // can never reach this: AuthService.signup(["customer","vendor"]) on the
  // public route rejects "admin" via its allowedTypes gate before this ever
  // runs, and registerUserSchema's zod enum rejects it at the request layer
  // too. The only caller that reaches here with userType "admin" is
  // POST /users/admins, which is already authMiddleware + roleGuard(["admin"]).
  admin: async () => undefined,
};
