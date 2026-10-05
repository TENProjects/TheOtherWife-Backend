/** @format */

// Read-only deployment pre-flight check. Run inside the app container on the
// droplet (production or staging) before/after a deploy:
//
//   docker compose exec api npx tsx src/scripts/preflight.ts
//   docker compose -f docker-compose.staging.yml -p tow-staging exec api npx tsx src/scripts/preflight.ts
//
// Checks configuration and database connectivity. NEVER writes anything and
// never prints secret values. Exits 1 if any check FAILs.

import dns from "dns";
import mongoose from "mongoose";

import { envconfig } from "../config/env.config.js";

type Result = { level: "PASS" | "WARN" | "FAIL"; check: string; detail: string };
const results: Result[] = [];
const pass = (check: string, detail = "") => results.push({ level: "PASS", check, detail });
const warn = (check: string, detail: string) => results.push({ level: "WARN", check, detail });
const fail = (check: string, detail: string) => results.push({ level: "FAIL", check, detail });

const isProduction = process.env.NODE_ENV === "production";

const checkEnv = () => {
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
    pass("NODE_ENV", process.env.NODE_ENV);
  } else {
    warn("NODE_ENV", `"${process.env.NODE_ENV ?? ""}" — expected production on a server (docs stay locked either way)`);
  }

  for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"] as const) {
    const value = envconfig[key];
    if (!value) fail(key, "missing");
    else if (value.length < 32) warn(key, "set, but shorter than 32 characters");
    else pass(key, "set");
  }

  if (!envconfig.MONGODB_URI) fail("MONGODB_URI", "missing");
  else pass("MONGODB_URI", "set");

  if (!envconfig.CRON_SECRET) fail("CRON_SECRET", "missing — the 5-minute partner tracking cron cannot authenticate");
  else pass("CRON_SECRET", "set");

  if (isProduction && (!envconfig.DOCS_USERNAME || !envconfig.DOCS_PASSWORD)) {
    warn("DOCS_USERNAME / DOCS_PASSWORD", "not both set — the full API docs (/tow) will be disabled (partner docs stay available)");
  } else {
    pass("DOCS_USERNAME / DOCS_PASSWORD", isProduction ? "set" : "not required outside production");
  }

  const key = envconfig.PARTNER_SECRETS_KEY;
  if (!key) {
    fail("PARTNER_SECRETS_KEY", "missing — partner webhooks and request signing cannot be configured");
  } else if (Buffer.from(key, "base64").length !== 32) {
    fail("PARTNER_SECRETS_KEY", "must be exactly 32 bytes, base64-encoded");
  } else {
    pass("PARTNER_SECRETS_KEY", "valid 32-byte key");
  }

  if (!envconfig.PAYSTACK_SECRET_KEY) warn("PAYSTACK_SECRET_KEY", "missing — payments will not work");
  else if (isProduction && envconfig.PAYSTACK_SECRET_KEY.startsWith("sk_test_")) {
    warn("PAYSTACK_SECRET_KEY", "is a TEST key (expected on staging only)");
  } else pass("PAYSTACK_SECRET_KEY", envconfig.PAYSTACK_SECRET_KEY.startsWith("sk_test_") ? "test key" : "set");
};

const checkDatabase = async () => {
  if (!envconfig.MONGODB_URI) return;
  if (process.env.NODE_ENV !== "production") dns.setServers(["8.8.8.8", "1.1.1.1"]);
  try {
    await mongoose.connect(envconfig.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    const db = mongoose.connection.db!;
    await db.admin().ping();
    pass("MongoDB connection", `connected to database "${db.databaseName}"`);

    const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ["users", "vendors", "orders", "payments"]) {
      if (collections.has(name)) pass(`collection ${name}`, `${await db.collection(name).estimatedDocumentCount()} documents`);
      else warn(`collection ${name}`, "not found — is this the right database?");
    }
    const partnerCollections = [
      "partners",
      "referralcampaigns",
      "referralcodes",
      "attributions",
      "partnersubmissions",
      "partnercredentials",
      "partneridempotencykeys",
      "partnerwebhookdeliveries",
      "platformcosts",
      "partnersettlements",
    ];
    const present = partnerCollections.filter((c) => collections.has(c));
    pass(
      "partner/referral collections",
      `${present.length}/${partnerCollections.length} exist (the rest are created automatically when the app starts or on first use)`,
    );
  } catch (error) {
    fail("MongoDB connection", (error as Error).message.replace(/mongodb(\+srv)?:\/\/[^@]*@/g, "mongodb$1://***@"));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

const main = async () => {
  checkEnv();
  await checkDatabase();
  const width = Math.max(...results.map((r) => r.check.length));
  for (const r of results) {
    console.log(`${r.level.padEnd(4)}  ${r.check.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => r.level === "FAIL").length;
  const warned = results.filter((r) => r.level === "WARN").length;
  console.log(`\n${failed ? "NOT READY" : "READY"} — ${failed} failed, ${warned} warning(s)`);
  process.exitCode = failed ? 1 : 0;
};

main();
