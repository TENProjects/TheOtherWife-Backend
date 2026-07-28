/** @format */

// One-off: seeds two test admin accounts — one "manager", one
// "support_agent" — so the dashboard's role-based nav visibility (see
// src/lib/rbac.ts on the admin frontend) can actually be logged into and
// eyeballed, without waiting on a real admin to create them through the UI.
//
// Creates the User doc directly (same shape auth.service.ts's signup()
// builds — passwordHash gets bcrypt-hashed by the model's own pre-save
// hook) with isEmailVerified: true so these accounts can log in
// immediately, skipping the normal email-verification step real admin
// signups require.
//
// Run with: npx tsx src/scripts/seed-admin-roles.ts
//
// Safe to rerun: if an account with the seed email already exists, its
// role/status/password are reset to the seed values instead of erroring
// on the duplicate-key check.

import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";

const SEED_PASSWORD = "QaTest#2026!";

const SEED_ADMINS = [
  {
    firstName: "QA",
    lastName: "Manager",
    email: "manager.qa@theotherwife.com",
    // phoneNumber has a sparse unique index — omitting it entirely is fine
    // in principle, but at least one existing document in the DB already
    // has phoneNumber explicitly set to null (not absent), which trips the
    // sparse index's uniqueness check for any other doc that also lacks
    // one. Giving these seed accounts real, unique placeholder numbers
    // sidesteps that pre-existing data issue rather than fixing it here.
    phoneNumber: "+2340000000001",
    adminRole: "manager" as const,
  },
  {
    firstName: "QA",
    lastName: "Support",
    email: "support.qa@theotherwife.com",
    phoneNumber: "+2340000000002",
    adminRole: "support_agent" as const,
  },
];

async function main() {
  const db = new Db();
  await db.connect();

  console.log("Seeding QA admin accounts...\n");

  for (const seed of SEED_ADMINS) {
    const existing = await User.findOne({ email: seed.email });

    if (existing) {
      existing.passwordHash = SEED_PASSWORD;
      existing.adminRole = seed.adminRole;
      existing.phoneNumber = seed.phoneNumber;
      existing.status = "active";
      existing.isEmailVerified = true;
      existing.markModified("passwordHash");
      await existing.save();
      console.log(`Updated existing account: ${seed.email} (${seed.adminRole})`);
    } else {
      await User.create({
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email,
        phoneNumber: seed.phoneNumber,
        passwordHash: SEED_PASSWORD,
        userType: "admin",
        adminRole: seed.adminRole,
        status: "active",
        isEmailVerified: true,
      });
      console.log(`Created new account: ${seed.email} (${seed.adminRole})`);
    }
  }

  console.log("\nDone. Log in with:");
  for (const seed of SEED_ADMINS) {
    console.log(`  ${seed.adminRole.padEnd(14)} ${seed.email} / ${SEED_PASSWORD}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
