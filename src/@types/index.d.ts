/** @format */

import mongoose from "mongoose";

declare global {
  namespace Express {
    interface User {
      _id?: mongoose.Types.ObjectId;
      userType?: string;
      adminRole?: "super_admin" | "manager" | "support_agent";
    }

    interface Request {
      user?: User;
      rawBody?: string;
    }
  }
}
