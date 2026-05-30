/** @format */

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import VendorPayoutAllocation from "../models/vendorPayoutAllocation.model.js";
import VendorPayoutRequest from "../models/vendorPayoutRequest.model.js";

const db = new Db();

const toObjectId = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  return null;
};

const backfillVendorPayoutRequests = async () => {
  const pendingToRequested = await VendorPayoutRequest.updateMany(
    { status: "pending" as any },
    { $set: { status: "requested" } },
  );

  const paidToApprovedPaid = await VendorPayoutRequest.updateMany(
    { status: "paid" as any },
    {
      $set: {
        status: "approved",
        paymentStatus: "paid",
      },
    },
  );

  const setPaymentStatusForPaidArtifacts = await VendorPayoutRequest.updateMany(
    {
      paymentStatus: { $exists: false },
      $or: [{ paidAt: { $exists: true, $ne: null } }, { payoutReference: { $exists: true, $ne: "" } }],
    },
    {
      $set: {
        paymentStatus: "paid",
      },
    },
  );

  const setDefaultPaymentStatus = await VendorPayoutRequest.updateMany(
    { paymentStatus: { $exists: false } },
    { $set: { paymentStatus: "unpaid" } },
  );

  return {
    pendingToRequested: pendingToRequested.modifiedCount,
    paidToApprovedPaid: paidToApprovedPaid.modifiedCount,
    setPaymentStatusForPaidArtifacts: setPaymentStatusForPaidArtifacts.modifiedCount,
    setDefaultPaymentStatus: setDefaultPaymentStatus.modifiedCount,
  };
};

const backfillPaymentVendorSettlement = async () => {
  const allocationAgg = await VendorPayoutAllocation.aggregate<{
    _id: mongoose.Types.ObjectId;
    allocated: number;
  }>([
    {
      $group: {
        _id: "$paymentId",
        allocated: { $sum: "$allocatedAmount" },
      },
    },
  ]);

  const allocatedByPaymentId = new Map<string, number>();
  for (const row of allocationAgg) {
    allocatedByPaymentId.set(row._id.toString(), row.allocated);
  }

  const payments = await Payment.find({}).select(
    "_id orderId vendorId status paidAt vendorGrossAmount vendorPlatformFeeAmount vendorNetAmount vendorSettledAmount settlementStatus settlementEligibleAt",
  );

  let updatedCount = 0;
  let skippedMissingOrder = 0;

  for (const payment of payments) {
    const orderId = toObjectId(payment.orderId);
    if (!orderId) {
      skippedMissingOrder += 1;
      continue;
    }

    const order = await Order.findById(orderId).select("vendorId totalAmount serviceCharge");
    if (!order) {
      skippedMissingOrder += 1;
      continue;
    }

    const vendorGrossAmount = Math.max(order.totalAmount ?? 0, 0);
    const vendorPlatformFeeAmount = Math.max(order.serviceCharge ?? 0, 0);
    const vendorNetAmount = Math.max(vendorGrossAmount - vendorPlatformFeeAmount, 0);

    const allocationSettled = allocatedByPaymentId.get(payment._id.toString()) ?? 0;
    const existingSettled = Math.max(payment.vendorSettledAmount ?? 0, 0);
    const vendorSettledAmount = Math.min(
      vendorNetAmount,
      Math.max(existingSettled, allocationSettled),
    );

    let settlementStatus: "ineligible" | "unsettled" | "partially_paid" | "paid" | "reversed" =
      "ineligible";
    let settlementEligibleAt: Date | undefined;

    if (payment.status === "succeeded") {
      settlementEligibleAt = payment.paidAt ?? new Date();
      if (vendorSettledAmount <= 0) {
        settlementStatus = "unsettled";
      } else if (vendorSettledAmount < vendorNetAmount) {
        settlementStatus = "partially_paid";
      } else {
        settlementStatus = "paid";
      }
    } else if (vendorSettledAmount > 0) {
      settlementStatus = "reversed";
    }

    const hasChanged =
      payment.vendorId?.toString() !== order.vendorId.toString() ||
      payment.vendorGrossAmount !== vendorGrossAmount ||
      payment.vendorPlatformFeeAmount !== vendorPlatformFeeAmount ||
      payment.vendorNetAmount !== vendorNetAmount ||
      payment.vendorSettledAmount !== vendorSettledAmount ||
      payment.settlementStatus !== settlementStatus ||
      (payment.settlementEligibleAt?.toISOString() ?? "") !==
        (settlementEligibleAt?.toISOString() ?? "");

    if (!hasChanged) {
      continue;
    }

    payment.vendorId = order.vendorId;
    payment.vendorGrossAmount = vendorGrossAmount;
    payment.vendorPlatformFeeAmount = vendorPlatformFeeAmount;
    payment.vendorNetAmount = vendorNetAmount;
    payment.vendorSettledAmount = vendorSettledAmount;
    payment.settlementStatus = settlementStatus;
    payment.settlementEligibleAt = settlementEligibleAt;

    await payment.save();
    updatedCount += 1;
  }

  return {
    allocationsScanned: allocationAgg.length,
    paymentsScanned: payments.length,
    paymentsUpdated: updatedCount,
    skippedMissingOrder,
  };
};

const run = async () => {
  try {
    await db.connect();

    const payoutRequestResult = await backfillVendorPayoutRequests();
    const paymentSettlementResult = await backfillPaymentVendorSettlement();

    console.log("Vendor payout request backfill:", payoutRequestResult);
    console.log("Payment settlement backfill:", paymentSettlementResult);
    console.log("Backfill complete");
  } catch (error) {
    console.error("Backfill failed", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
