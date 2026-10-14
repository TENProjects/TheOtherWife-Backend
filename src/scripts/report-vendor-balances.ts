/** @format */

// READ-ONLY report: how each vendor's wallet balance is calculated before and
// after this release, plus any payment whose recorded vendor split is not the
// 80/20 rule. It only reads (find/aggregate) — it never writes. Run it against
// production before deploying to see exactly which balances change:
//
//   npm run report:vendor-balances            table of vendors that change
//   npm run report:vendor-balances -- --all   every vendor
//   npm run report:vendor-balances -- --json  machine-readable output
//
// Uses MONGODB_URI from the env file like the app. Prints the database name
// first so you can confirm where it is reading from.

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { Db } from "../config/db.config.js";
import Payment from "../models/payment.model.js";
import Order from "../models/order.model.js";
import Vendor from "../models/vendor.model.js";
import {
  isLegacyServiceChargeSplit,
  vendorSplitOf,
} from "../util/finance-definitions.util.js";

const SHOW_ALL = process.argv.includes("--all");
const AS_JSON = process.argv.includes("--json");

type Row = {
  vendorId: string;
  businessName: string;
  availableBefore: number;
  availableAfter: number;
  lifetimeBefore: number;
  lifetimeAfter: number;
  refundedPayments: number;
  clawbackTotal: number;
  nonStandardSplits: number;
  legacyServiceChargeSplits: number;
};

const money = (value: number) => Math.round(value * 100) / 100;

export const buildVendorBalanceReport = async (): Promise<Row[]> => {
  const payments = await Payment.find({
    context: { $ne: "meal_plan" },
    status: { $in: ["succeeded", "refunded"] },
  })
    .select(
      "orderId vendorId status vendorGrossAmount vendorPlatformFeeAmount vendorNetAmount vendorSettledAmount vendorClawbackAmount",
    )
    .lean();

  const orderIds = payments.map((payment) => payment.orderId).filter(Boolean);
  const orders = await Order.find({ _id: { $in: orderIds } })
    .select("subtotal discountAmount serviceCharge totalAmount")
    .lean();
  const orderById = new Map(orders.map((order) => [String(order._id), order]));

  const rows = new Map<string, Row>();
  for (const payment of payments) {
    if (!payment.vendorId) continue;
    const key = String(payment.vendorId);
    const row =
      rows.get(key) ??
      ({
        vendorId: key,
        businessName: "",
        availableBefore: 0,
        availableAfter: 0,
        lifetimeBefore: 0,
        lifetimeAfter: 0,
        refundedPayments: 0,
        clawbackTotal: 0,
        nonStandardSplits: 0,
        legacyServiceChargeSplits: 0,
      } satisfies Row);

    const net = payment.vendorNetAmount ?? 0;
    const settled = payment.vendorSettledAmount ?? 0;
    const clawback = payment.vendorClawbackAmount ?? 0;
    const owed = net - settled - clawback;

    // Before: only "succeeded" payments counted.
    if (payment.status === "succeeded") {
      row.availableBefore += owed;
      row.lifetimeBefore += net;
    } else {
      row.refundedPayments += 1;
    }
    // After: succeeded + refunded, lifetime net of clawbacks.
    row.availableAfter += owed;
    row.lifetimeAfter += net - clawback;
    row.clawbackTotal += clawback;

    const order = payment.orderId ? orderById.get(String(payment.orderId)) : undefined;
    if (order) {
      if (isLegacyServiceChargeSplit(payment, order)) {
        row.legacyServiceChargeSplits += 1;
      } else {
        const expected = vendorSplitOf((order.subtotal ?? 0) - (order.discountAmount ?? 0));
        if (expected.vendorNetAmount !== net) row.nonStandardSplits += 1;
      }
    }

    rows.set(key, row);
  }

  const vendors = await Vendor.find({ _id: { $in: [...rows.keys()] } })
    .select("businessName")
    .lean();
  for (const vendor of vendors) {
    const row = rows.get(String(vendor._id));
    if (row) row.businessName = vendor.businessName ?? "";
  }

  return [...rows.values()].map((row) => ({
    ...row,
    // The wallet floors the total (not each payment) at zero.
    availableBefore: money(Math.max(row.availableBefore, 0)),
    availableAfter: money(Math.max(row.availableAfter, 0)),
    lifetimeBefore: money(row.lifetimeBefore),
    lifetimeAfter: money(Math.max(row.lifetimeAfter, 0)),
    clawbackTotal: money(row.clawbackTotal),
  }));
};

const run = async () => {
  const db = new Db();
  try {
    await db.connect();
    const databaseName = mongoose.connection.db?.databaseName;
    console.error(`Reading (read-only) from database: ${databaseName}`);

    const report = await buildVendorBalanceReport();
    const changed = report.filter(
      (row) =>
        row.availableBefore !== row.availableAfter ||
        row.lifetimeBefore !== row.lifetimeAfter ||
        row.nonStandardSplits > 0 ||
        row.legacyServiceChargeSplits > 0,
    );
    const rows = SHOW_ALL ? report : changed;

    if (AS_JSON) {
      console.log(JSON.stringify({ databaseName, vendors: rows }, null, 2));
    } else {
      console.table(rows);
      console.log(
        `${report.length} vendor(s) with paid orders; ${changed.length} whose balance changes or with non-80/20 splits.`,
      );
    }
  } catch (error) {
    console.error("Report failed", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
