/** @format */

import mongoose from "mongoose";

declare global {
  namespace Express {
    interface User {
      _id?: mongoose.Types.ObjectId;
      userType?: string;
      adminRole?: "super_admin" | "manager" | "support_agent";
    }

    // Set only by partnerAuthMiddleware on /api/v1/partner/* routes — never
    // alongside req.user. A partner credential is a machine identity scoped
    // to a single Partner and an explicit list of scopes.
    interface PartnerContext {
      partnerId: mongoose.Types.ObjectId;
      credentialId: mongoose.Types.ObjectId;
      keyId: string;
      scopes: string[];
    }

    interface Request {
      user?: User;
      rawBody?: string;
      partner?: PartnerContext;
    }
  }
}
