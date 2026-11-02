/** @format */

// One-off catch-up: Paystack subaccounts for APPROVED vendors that don't have
// one yet, using their bank details (payout settings, or the onboarding
// step 2 details if payout settings are empty).
//
// DRY RUN by default: it only reads and prints who would be affected.
//
//   npm run backfill:paystack-subaccounts                 dry run (no writes)
//   npm run backfill:paystack-subaccounts -- --apply      create subaccounts
//   ... -- --apply --limit 5                              at most 5 vendors
//   ... -- --apply --vendor <vendorId>                    one vendor only
//
// --apply goes through VendorService.retryPaystackSubaccountCreation, the
// same code path as admin approval and the admin "Retry" button: it never
// overwrites saved payout settings, Paystack verifies every account with the
// bank, and failures are stored on the vendor (paystackSubaccountError) for
// the admin subaccount list. Vendors are processed one at a time with a
// pause, to stay well inside Paystack's rate limits. Safe to re-run: vendors
// that got a subaccount are skipped next time.

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { Db } from "../config/db.config.js";
import Vendor from "../models/vendor.model.js";
import { VendorService } from "../services/vendor.service.js";
import { hasPayoutBankDetails, onboardingBankDetails } from "../util/vendor-bank-details.util.js";

const APPLY = process.argv.includes("--apply");
const argValue = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = Math.min(Math.max(Number(argValue("--limit") ?? 50) || 50, 1), 500);
const ONLY_VENDOR = argValue("--vendor");
const PAUSE_MS = 1500;

const mask = (value?: string) => (value && value.length > 4 ? `******${value.slice(-4)}` : value ?? "");

type Plan = {
  vendorId: string;
  businessName: string;
  source: "payout_settings" | "onboarding" | "none";
  bank: string;
  account: string;
  previousError: string;
};

const planFor = (vendor: any): Plan => {
  const fromPayout = hasPayoutBankDetails(vendor.payoutSettings) ? vendor.payoutSettings.bankDetails : null;
  const fromOnboarding = fromPayout ? null : onboardingBankDetails(vendor.additionalData);
  const details = fromPayout ?? fromOnboarding;
  return {
    vendorId: String(vendor._id),
    businessName: vendor.businessName ?? "",
    source: fromPayout ? "payout_settings" : fromOnboarding ? "onboarding" : "none",
    bank: details?.bankName ?? "",
    account: mask(details?.accountNumber),
    previousError: vendor.paystackSubaccountError ?? "",
  };
};

const run = async () => {
  if (ONLY_VENDOR && !mongoose.isValidObjectId(ONLY_VENDOR)) {
    console.error("--vendor must be a vendor id");
    process.exitCode = 2;
    return;
  }
  const db = new Db();
  try {
    await db.connect();
    console.error(`Database: ${mongoose.connection.db?.databaseName} | mode: ${APPLY ? "APPLY (writes)" : "dry run (read-only)"}`);

    const query: Record<string, unknown> = {
      approvalStatus: "approved",
      $or: [{ paystackSubaccountCode: null }, { paystackSubaccountCode: "" }],
    };
    if (ONLY_VENDOR) query._id = new mongoose.Types.ObjectId(ONLY_VENDOR);

    const vendors = await Vendor.find(query)
      .select("businessName payoutSettings additionalData paystackSubaccountError approvalStatus")
      .sort({ approvedAt: 1 })
      .lean();
    const plans = vendors.map(planFor);
    const actionable = plans.filter((p) => p.source !== "none");

    console.table(plans);
    console.log(
      `${plans.length} approved vendor(s) without a subaccount: ${actionable.length} with usable bank details, ` +
        `${plans.length - actionable.length} with none (they must add bank details in the app).`,
    );

    if (!APPLY) {
      console.log("Dry run: nothing was changed. Re-run with --apply to create subaccounts.");
      return;
    }

    const service = new VendorService();
    const batch = actionable.slice(0, LIMIT);
    let created = 0;
    let failed = 0;
    for (const [index, plan] of batch.entries()) {
      const { vendor } = await service.retryPaystackSubaccountCreation(plan.vendorId);
      if (vendor.paystackSubaccountCode) {
        created += 1;
        console.log(`OK      ${plan.businessName} (${plan.vendorId}) from ${plan.source}`);
      } else {
        failed += 1;
        console.log(`FAILED  ${plan.businessName} (${plan.vendorId}): ${vendor.paystackSubaccountError ?? "unknown error"}`);
      }
      if (index < batch.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    console.log(
      `Done: ${created} created, ${failed} failed (see the admin subaccount list), ` +
        `${Math.max(actionable.length - batch.length, 0)} left for the next run (--limit ${LIMIT}).`,
    );
  } catch (error) {
    console.error("Backfill failed", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
