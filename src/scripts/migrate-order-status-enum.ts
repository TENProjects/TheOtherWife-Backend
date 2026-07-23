/** @format */

// One-off: migrates existing Order documents to the consolidated status/
// paymentStatus enums (see order.model.ts). Mongoose only validates on
// write, so documents created before this change keep their old string
// values until touched — this rewrites them so every Order matches the
// current schema and nothing throws a validation error the next time one of
// them is saved.
//
//   customer_cancelled -> status: cancelled, cancellationReason: customer_requested
//   vendor_rejected    -> status: cancelled, cancellationReason: vendor_unavailable
//   payment_failed     -> status: cancelled, cancellationReason: payment_timeout
//   expired (status)   -> status: cancelled, cancellationReason: payment_timeout
//   paymentStatus "succeeded" -> "paid"
//   paymentStatus "expired"   -> "failed"
//
// Only touches documents still holding an old value — safe to rerun (a
// second run finds nothing left to update).
//
// Run with: npx tsx src/scripts/migrate-order-status-enum.ts

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import Order from "../models/order.model.js";

const db = new Db();

const migrateStatus = async (
  oldStatus: string,
  cancellationReason: "customer_requested" | "vendor_unavailable" | "payment_timeout",
) => {
  const result = await Order.updateMany(
    { status: oldStatus as any },
    { $set: { status: "cancelled", cancellationReason } },
  );
  return result.modifiedCount;
};

const run = async () => {
  try {
    await db.connect();
    console.log(`Connected to ${mongoose.connection.name}`);

    const customerCancelled = await migrateStatus("customer_cancelled", "customer_requested");
    const vendorRejected = await migrateStatus("vendor_rejected", "vendor_unavailable");
    const paymentFailed = await migrateStatus("payment_failed", "payment_timeout");
    const expiredStatus = await migrateStatus("expired", "payment_timeout");

    const succeededToPaid = await Order.updateMany(
      { paymentStatus: "succeeded" as any },
      { $set: { paymentStatus: "paid" } },
    );
    const expiredPaymentStatus = await Order.updateMany(
      { paymentStatus: "expired" as any },
      { $set: { paymentStatus: "failed" } },
    );

    console.log("Order status migration:", {
      customer_cancelled_to_cancelled: customerCancelled,
      vendor_rejected_to_cancelled: vendorRejected,
      payment_failed_to_cancelled: paymentFailed,
      expired_status_to_cancelled: expiredStatus,
      paymentStatus_succeeded_to_paid: succeededToPaid.modifiedCount,
      paymentStatus_expired_to_failed: expiredPaymentStatus.modifiedCount,
    });
    console.log("Migration complete.");
  } catch (error) {
    console.error("Migration failed", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
