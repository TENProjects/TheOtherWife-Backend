/** @format */

// Production bootstrap: builds every model's indexes, seeds the MealCategory
// taxonomy (idempotent — upserts by `category`, never duplicates), and
// upserts the super admin account. Non-destructive: never deletes or
// truncates anything. Safe to rerun.
//
// The `Category` model (src/models/category.model.ts) is intentionally not
// data-seeded here — it's unreferenced by the app (see the comment in
// reset-for-testing.ts); only its indexes get created below, for
// consistency, in case the collection is ever used.
//
// Run with MONGODB_URI pointing at the target cluster, e.g.:
//   MONGODB_URI="mongodb+srv://user:pass@host/db" npx tsx src/scripts/seed-production-init.ts

import dns from "dns";
import mongoose from "mongoose";

// This machine's default resolver (127.0.0.1) refuses raw UDP DNS queries,
// which breaks Node's SRV/TXT lookups for mongodb+srv:// URIs even though
// the OS-level resolver works fine. Point Node at public resolvers so the
// driver's SRV discovery succeeds.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import { Db } from "../config/db.config.js";
import MealCategory, { CategoryType } from "../models/mealCategory.model.js";
import User from "../models/user.model.js";

// Side-effect imports: register every remaining schema with mongoose so the
// createIndexes() loop below covers the whole app, not just the two models
// used for data-seeding above.
import "../models/address.model.js";
import "../models/adminAuditLog.model.js";
import "../models/blogPost.model.js";
import "../models/cart.model.js";
import "../models/category.model.js";
import "../models/counter.model.js";
import "../models/customer.model.js";
import "../models/favourites.model.js";
import "../models/financialSettings.model.js";
import "../models/meal.model.js";
import "../models/mealPlan.model.js";
import "../models/mealReview.model.js";
import "../models/notification.model.js";
import "../models/order.model.js";
import "../models/payment.model.js";
import "../models/paymentLedgerEntry.model.js";
import "../models/platformSettings.model.js";
import "../models/promoCampaign.model.js";
import "../models/promoCode.model.js";
import "../models/refundRequest.model.js";
import "../models/scheduledMeal.model.js";
import "../models/siteContent.model.js";
import "../models/supportTicket.model.js";
import "../models/vendor.model.js";
import "../models/vendorCallLog.model.js";
import "../models/vendorClawback.model.js";
import "../models/vendorIssue.model.js";
import "../models/vendorMessage.model.js";
import "../models/vendorPayoutAllocation.model.js";
import "../models/vendorPayoutRequest.model.js";
import "../models/vendorWarning.model.js";
import "../models/wallet.model.js";
import "../models/walletTransaction.model.js";

const SUPER_ADMIN = {
  firstName: "Super",
  lastName: "Admin",
  email: "admin@theotherwife.com",
  password: "#BolaMola2210",
};

async function seedIndexes() {
  const modelNames = mongoose.modelNames();
  for (const name of modelNames) {
    // createIndexes() only adds indexes missing from the schema definition —
    // unlike syncIndexes() it never drops anything, so it's safe to run
    // against a production database that may have other indexes already.
    await mongoose.model(name).createIndexes();
    console.log(`  Indexes ensured: ${name}`);
  }
}

async function seedCategories() {
  for (const categoryValue of Object.values(CategoryType)) {
    await MealCategory.findOneAndUpdate(
      { category: categoryValue },
      {
        $setOnInsert: {
          category: categoryValue,
          description: `${categoryValue} category`,
        },
      },
      { upsert: true, new: true },
    );
    console.log(`  Category ensured: ${categoryValue}`);
  }
}

async function seedSuperAdmin() {
  const existing = await User.findOne({ email: SUPER_ADMIN.email });

  if (existing) {
    existing.passwordHash = SUPER_ADMIN.password;
    existing.userType = "admin";
    existing.adminRole = "super_admin";
    existing.status = "active";
    existing.isEmailVerified = true;
    existing.markModified("passwordHash");
    await existing.save();
    console.log(`  Updated existing super admin: ${SUPER_ADMIN.email}`);
  } else {
    await User.create({
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
      email: SUPER_ADMIN.email,
      passwordHash: SUPER_ADMIN.password,
      userType: "admin",
      adminRole: "super_admin",
      authType: "email",
      status: "active",
      isEmailVerified: true,
    });
    console.log(`  Created super admin: ${SUPER_ADMIN.email}`);
  }
}

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to database: ${mongoose.connection.name}\n`);

  console.log("Ensuring indexes...");
  await seedIndexes();

  console.log("\nSeeding meal categories...");
  await seedCategories();

  console.log("\nSeeding super admin...");
  await seedSuperAdmin();

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
