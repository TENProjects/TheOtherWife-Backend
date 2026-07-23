/** @format */

// One-off: seeds VendorPayoutRequest documents spanning every
// status/paymentStatus combination the admin Wallet Management screen needs
// to QA (requested, processing, approved-but-unpaid, approved-and-paid,
// rejected), against real vendors already in the DB. Also ensures the
// FinancialSettings singleton exists (created with schema defaults only if
// missing — never overwrites an existing one), since the admin Financials
// page reads from it.
//
// Does not fabricate vendors/users/orders/payments — reuses whatever
// approved vendors already exist (run `npm run seed` first if there are
// none). Wallet balance figures shown here come from the same
// succeeded-Payment aggregation VendorWalletService.getVendorWalletSummary
// uses, read-only, purely to size realistic requestedAmount values.
//
// Run with: npx tsx src/scripts/seed-vendor-payout-requests.ts
//
// Safe to rerun: deletes its own previously-seeded requests (matched by the
// "[QA seed]" note prefix) before creating a fresh batch.

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import Payment from "../models/payment.model.js";
import FinancialSettings from "../models/financialSettings.model.js";
import VendorPayoutRequest from "../models/vendorPayoutRequest.model.js";

const NOTE_TAG = "[QA seed]";

const FALLBACK_BANK_DETAILS = {
  bankName: "GTBank",
  accountName: "Sample Vendor Business",
  accountNumber: "0123456789",
};

type ScenarioName = "requested" | "processing" | "approved_unpaid" | "approved_paid" | "rejected";

const SCENARIOS: ScenarioName[] = [
  "requested",
  "processing",
  "approved_unpaid",
  "approved_paid",
  "rejected",
];

async function getAvailableToPayout(vendorId: mongoose.Types.ObjectId) {
  const [summary] = await Payment.aggregate<{ pendingRaw: number }>([
    { $match: { vendorId, status: "succeeded" } },
    {
      $group: {
        _id: null,
        pendingRaw: {
          $sum: {
            $subtract: [
              "$vendorNetAmount",
              { $add: ["$vendorSettledAmount", { $ifNull: ["$vendorClawbackAmount", 0] }] },
            ],
          },
        },
      },
    },
  ]);

  return Math.max(summary?.pendingRaw ?? 0, 0);
}

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const vendors = await Vendor.find({ approvalStatus: "approved" }).limit(SCENARIOS.length);
  if (vendors.length === 0) {
    throw new Error(
      "No approved vendors found — run `npm run seed` first, or approve at least one vendor via the app.",
    );
  }

  const adminUser = await User.findOne({ userType: "admin" });
  if (!adminUser) {
    console.log("No admin user found — approvedBy/processedBy will be left unset.");
  }

  // Clean up this script's own previous runs before reseeding.
  const deleted = await VendorPayoutRequest.deleteMany({ note: { $regex: `^\\${NOTE_TAG}` } });
  if (deleted.deletedCount > 0) {
    console.log(`Removed ${deleted.deletedCount} previously-seeded payout request(s).`);
  }

  const created: string[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const vendor = vendors[i % vendors.length];
    const availableToPayout = await getAvailableToPayout(vendor._id as mongoose.Types.ObjectId);
    // Illustrative amount — sized off real available balance when there is
    // one, otherwise a plausible flat figure; not passed through
    // VendorWalletService.requestVendorPayout, so it isn't blocked by the
    // "amount <= availableToPayout" runtime check that flow enforces.
    const requestedAmount = availableToPayout > 0 ? Math.round(availableToPayout * 0.6) : 25000;
    const bankDetailsSnapshot = vendor.payoutSettings?.bankDetails?.bankName
      ? vendor.payoutSettings.bankDetails
      : FALLBACK_BANK_DETAILS;
    const now = new Date();

    const base = {
      vendorId: vendor._id,
      requestedAmount,
      currency: "NGN",
      bankDetailsSnapshot,
      note: `${NOTE_TAG} ${vendor.businessName ?? vendor._id.toString()}`,
    };

    let doc: Record<string, unknown>;
    switch (scenario) {
      case "requested":
        doc = { ...base, status: "requested", paymentStatus: "unpaid", approvedAmount: 0 };
        break;
      case "processing":
        doc = { ...base, status: "processing", paymentStatus: "unpaid", approvedAmount: 0 };
        break;
      case "approved_unpaid":
        doc = {
          ...base,
          status: "approved",
          paymentStatus: "unpaid",
          approvedAmount: requestedAmount,
          approvedBy: adminUser?._id,
          approvedAt: now,
        };
        break;
      case "approved_paid":
        doc = {
          ...base,
          status: "approved",
          paymentStatus: "paid",
          approvedAmount: requestedAmount,
          approvedBy: adminUser?._id,
          processedBy: adminUser?._id,
          approvedAt: now,
          paidAt: now,
          payoutReference: `tow_seed_payout_${vendor._id.toString()}`,
        };
        break;
      case "rejected":
        doc = {
          ...base,
          status: "rejected",
          paymentStatus: "unpaid",
          approvedAmount: 0,
          rejectionReason: "Bank details could not be verified.",
        };
        break;
    }

    const payoutRequest = await VendorPayoutRequest.create(doc);
    created.push(
      `${payoutRequest._id.toString()}  vendor=${vendor.businessName ?? vendor._id.toString()}  status=${payoutRequest.status}  paymentStatus=${payoutRequest.paymentStatus}  amount=${requestedAmount}`,
    );
  }

  console.log("\nCreated payout requests:");
  created.forEach((line) => console.log(`  ${line}`));

  const existingSettings = await FinancialSettings.findOne();
  if (existingSettings) {
    console.log("\nFinancialSettings singleton already exists — left untouched.");
  } else {
    await FinancialSettings.create({});
    console.log("\nCreated FinancialSettings singleton with schema defaults.");
  }
}

main()
  .then(() => console.log("\nSeed complete."))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
