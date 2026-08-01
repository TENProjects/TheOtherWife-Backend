/** @format */

// One-off diagnostic, read-only. Run with:
// NODE_ENV=production npx tsx src/scripts/diagnose-deletion-otp.ts <email>

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";

const email = process.argv[2];

async function main() {
  if (!email) {
    throw new Error("Usage: npx tsx src/scripts/diagnose-deletion-otp.ts <email>");
  }

  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name} (host: ${mongoose.connection.host})`);

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
    "email userType status deletionOtpHash deletionOtpExpiresAt deletionOtpAttempts deletionType deletionReference createdAt",
  );

  if (!user) {
    console.log(`No User document found for email: ${email}`);
    return;
  }

  console.log("Found user:", {
    email: user.email,
    userType: user.userType,
    status: user.status,
    hasPendingOtp: !!user.deletionOtpHash,
    deletionOtpExpiresAt: user.deletionOtpExpiresAt,
    deletionOtpAttempts: user.deletionOtpAttempts,
    deletionType: user.deletionType,
    deletionReference: user.deletionReference,
    createdAt: user.createdAt,
  });
}

main()
  .then(() => console.log("Done."))
  .catch((err) => {
    console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
