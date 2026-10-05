/** @format */

// Idempotent setup of a partner, its campaign (with the agreed commercial
// rules) and its referral codes. Safe to re-run: existing records are found
// by slug / name / code and left unchanged. Does NOT issue API keys or
// webhook secrets (do that through the admin API so secrets never reach shell
// history or logs).
//
// FoodClime, inside the app container:
//   docker compose exec api npx tsx src/scripts/setup-partner-campaign.ts \
//     --admin-email admin@theotherwife.com \
//     --partner-name "FoodClime / Peace Sustainability" --slug foodclime \
//     --campaign-name "FoodClime 2026" \
//     --starts-at 2026-09-26 --ends-at 2026-11-24 \
//     --homechef-code FOODCLIME-CHEF --customer-code FOODCLIME
//
// Add --dry-run to print what would happen without writing anything.

import dns from "dns";
import mongoose from "mongoose";

import { envconfig } from "../config/env.config.js";
import Partner from "../models/partner.model.js";
import ReferralCampaign from "../models/referralCampaign.model.js";
import ReferralCode from "../models/referralCode.model.js";
import User from "../models/user.model.js";
import { referralAdminService } from "../services/referral-admin.service.js";
import { normalizeReferralCode } from "../util/referral.util.js";

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const dryRun = args.includes("--dry-run");

// The agreed rules (business confirmation, Oct 2026).
const AGREED_RULES = {
  homechef: {
    earlyTierSize: 100,
    requireInspection: true,
    requireMenu: true,
    completedOrdersAfterEarlyTier: 1,
    payoutPerHomechef: 3000,
    settlementBatchSize: 50,
    payableCap: 1000,
    windowDays: 90,
  },
  customer: { revenueSharePercent: 10, deductPlatformCost: true },
  active: { minCompletedOrdersPerWeek: 1, internalTargetPerWeek: 2 },
};

const required = (name: string) => {
  const value = arg(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(2);
  }
  return value;
};

// "YYYY-MM-DD" → 00:00 WAT (UTC+1) that day.
const watDate = (value: string, name: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`--${name} must be YYYY-MM-DD`);
    process.exit(2);
  }
  return new Date(`${value}T00:00:00+01:00`);
};

const main = async () => {
  const adminEmail = required("admin-email").toLowerCase();
  const partnerName = required("partner-name");
  const slug = required("slug").toLowerCase();
  const campaignName = required("campaign-name");
  const startsAt = watDate(required("starts-at"), "starts-at");
  const endsAt = watDate(required("ends-at"), "ends-at");
  const homechefCode = normalizeReferralCode(required("homechef-code"));
  const customerCode = normalizeReferralCode(required("customer-code"));
  if (!homechefCode || !customerCode) {
    console.error("Codes must be 4-32 characters: letters, digits and single hyphens");
    process.exit(2);
  }
  if (endsAt <= startsAt) {
    console.error("--ends-at must be after --starts-at");
    process.exit(2);
  }

  if (process.env.NODE_ENV !== "production") dns.setServers(["8.8.8.8", "1.1.1.1"]);
  await mongoose.connect(envconfig.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to database "${mongoose.connection.name}"${dryRun ? " (dry run — no writes)" : ""}\n`);

  const admin = await User.findOne({ email: adminEmail, userType: "admin" }).select("_id adminRole");
  if (!admin) throw new Error(`No admin user with email ${adminEmail}`);
  const adminId = String(admin._id);

  let partner = await Partner.findOne({ slug });
  if (partner) console.log(`Partner     exists   ${partner.name} (${slug})`);
  else if (dryRun) console.log(`Partner     CREATE   ${partnerName} (${slug})`);
  else {
    partner = await referralAdminService.createPartner(adminId, { name: partnerName, slug });
    console.log(`Partner     created  ${partnerName} (${slug})`);
  }

  let campaign = partner ? await ReferralCampaign.findOne({ partnerId: partner._id, name: campaignName }) : null;
  if (campaign) {
    console.log(`Campaign    exists   ${campaignName} — rules ${campaign.rules ? "set" : "NOT set (add them via PATCH /admin/referrals/campaigns/:id)"}`);
  } else if (dryRun || !partner) {
    console.log(`Campaign    CREATE   ${campaignName}, ${startsAt.toISOString()} → ${endsAt.toISOString()}, with the agreed rules`);
  } else {
    campaign = await referralAdminService.createCampaign(adminId, {
      name: campaignName,
      programType: "partner",
      partnerId: String(partner._id),
      status: "active",
      startsAt,
      endsAt,
      audiences: ["vendor", "customer"],
      customerAttributionDays: 90,
      claimWindowDays: 7,
      targets: { homechefs: 1000 },
      rules: AGREED_RULES,
    });
    console.log(`Campaign    created  ${campaignName} (id ${campaign!._id})`);
  }

  for (const [code, audience] of [
    [homechefCode, "vendor"],
    [customerCode, "customer"],
  ] as const) {
    const existing = await ReferralCode.findOne({ code });
    if (existing) {
      const sameCampaign = campaign && existing.campaignId.equals(campaign._id as any);
      console.log(`Code        exists   ${code}${sameCampaign ? "" : "  ⚠ belongs to a different campaign"}`);
    } else if (dryRun || !campaign) {
      console.log(`Code        CREATE   ${code} (${audience})`);
    } else {
      await referralAdminService.createCode(adminId, String(campaign._id), { code, audience });
      console.log(`Code        created  ${code} (${audience})`);
    }
  }

  console.log(
    `\nNext: issue the partner API key (super_admin):\n  POST /api/v1/admin/referrals/partners/${partner?._id ?? "<partnerId>"}/credentials\n` +
      `then set the webhook once the partner sends its URL:\n  PUT  /api/v1/admin/referrals/partners/${partner?._id ?? "<partnerId>"}/webhook`,
  );
};

main()
  .catch((error) => {
    console.error("Setup failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => undefined));
