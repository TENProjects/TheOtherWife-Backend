/** @format */

// One-off: marks a single user's email as verified. Run with:
// NODE_ENV=production npx tsx src/scripts/verify-customer.ts <email>

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";

const email = process.argv[2];

async function main() {
  if (!email) {
    throw new Error("Usage: npx tsx src/scripts/verify-customer.ts <email>");
  }

  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const user = await User.findOne({ email });
  if (!user) {
    throw new Error(`No user found with email ${email}`);
  }

  user.isEmailVerified = true;
  await user.save();

  console.log(
    `Updated ${user.email} (userType=${user.userType}): isEmailVerified=${user.isEmailVerified}`,
  );
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
