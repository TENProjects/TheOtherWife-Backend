/** @format */

// One-off: seeds a spread of Orders (covering every order.status enum value,
// paired with a plausible paymentStatus, and matching succeeded/refunded
// Payment records) between a given customer and vendor, for manually
// testing the customer order-history and vendor order-management screens
// across every status. Reuses the customer's real (singleton) Cart and the
// vendor's real meals/customizations rather than fabricating either — run
// with: NODE_ENV=production npx tsx src/scripts/seed-orders-for-vendor.ts
//
// Safe to rerun: deletes its own previously-seeded orders/payments (matched
// by the "tow_seed_" payment reference prefix) before creating a fresh batch.

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import Address from "../models/address.model.js";
import Cart from "../models/cart.model.js";
import Meal from "../models/meal.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";

const CUSTOMER_EMAIL = "eseoghenedavid1@gmail.com";
const VENDOR_EMAIL = "theodoraishola@gmail.com";

const SERVICE_CHARGE_THRESHOLD = 15000;
const calculateServiceCharge = (effectiveSubtotal: number): number => {
  const rate = effectiveSubtotal < SERVICE_CHARGE_THRESHOLD ? 0.049 : 0.029;
  return Math.round(effectiveSubtotal * rate);
};

// Every order.status enum value, paired with the paymentStatus it would
// realistically carry, and — for "cancelled" — every cancellationReason
// value. Covers all 7 status values, all 4 paymentStatus values, and all 3
// cancellationReason values.
const SCENARIOS: Array<{
  status: string;
  paymentStatus: string;
  cancellationReason?: string;
  discountAmount?: number;
  paidAt?: boolean;
  deliveredAt?: boolean;
}> = [
  { status: "pending_payment", paymentStatus: "pending" },
  { status: "paid", paymentStatus: "paid", paidAt: true },
  { status: "confirmed", paymentStatus: "paid", paidAt: true },
  { status: "preparing", paymentStatus: "paid", paidAt: true },
  { status: "out_for_delivery", paymentStatus: "paid", paidAt: true, discountAmount: 500 },
  { status: "delivered", paymentStatus: "paid", paidAt: true, deliveredAt: true },
  { status: "cancelled", cancellationReason: "customer_requested", paymentStatus: "refunded", paidAt: true },
  { status: "cancelled", cancellationReason: "vendor_unavailable", paymentStatus: "refunded", paidAt: true },
  { status: "cancelled", cancellationReason: "payment_timeout", paymentStatus: "failed" },
];

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const customerUser = await User.findOne({ email: CUSTOMER_EMAIL });
  if (!customerUser) throw new Error(`Customer not found: ${CUSTOMER_EMAIL}`);

  const vendorUser = await User.findOne({ email: VENDOR_EMAIL });
  if (!vendorUser) throw new Error(`Vendor user not found: ${VENDOR_EMAIL}`);

  const vendor = await Vendor.findOne({ userId: vendorUser._id });
  if (!vendor) throw new Error(`Vendor profile not found for ${VENDOR_EMAIL}`);

  const address = await Address.findOne({ userId: customerUser._id }).sort({ isDefault: -1 });
  if (!address) {
    throw new Error(
      `No address on file for ${CUSTOMER_EMAIL} — add one via the app first (needed for addressSnapshot).`,
    );
  }

  // Reuse the customer's real, singleton cart (Cart.customerId is unique —
  // every one of a customer's orders, past or present, references this same
  // document; checkout only ever clears its `meals` array, never deletes
  // it) instead of fabricating a separate Cart per seeded order.
  const cart = await Cart.findOne({ customerId: customerUser._id });
  if (!cart) {
    throw new Error(
      `${CUSTOMER_EMAIL} has no cart on file — add a meal to cart via the app first.`,
    );
  }

  // Reuse the vendor's real meals + the exact real customizations already
  // sitting in the customer's cart, rather than fabricating placeholder
  // meals — a previous run of this script wrongly created fake ones when
  // its meal query missed the vendor's real (later-added) meals; clean
  // those up if present.
  const fakeMealNames = ["Jollof Rice & Chicken", "Egusi Soup & Pounded Yam"];
  const deletedFakeMeals = await Meal.deleteMany({
    vendorId: vendor._id,
    name: { $in: fakeMealNames },
  });
  if (deletedFakeMeals.deletedCount > 0) {
    console.log(`Removed ${deletedFakeMeals.deletedCount} previously-fabricated placeholder meal(s).`);
  }

  if (cart.meals.length === 0) {
    throw new Error(
      `${CUSTOMER_EMAIL}'s cart is empty — add meals from ${VENDOR_EMAIL} via the app first so this script has real items/customizations to reuse.`,
    );
  }

  const mealDocs = await Meal.find({
    _id: { $in: cart.meals.map((m) => m.mealId) },
  }).select("name");
  const mealNameById = new Map(mealDocs.map((m) => [m._id.toString(), m.name]));

  const cartItems = cart.meals.map((item) => ({
    mealId: item.mealId,
    mealName: mealNameById.get(item.mealId.toString()) ?? "Meal",
    quantity: item.quantity,
    unitPrice: item.effectiveUnitPrice ?? item.price,
    lineTotal: item.totalPrice,
    customization: item.customization,
  }));

  const addressSnapshot = {
    label: address.label,
    address: address.address,
    city: address.city,
    state: address.state,
    country: address.country,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
  };

  // Clean up this script's own previous runs before reseeding.
  const previousPayments = await Payment.find({ reference: /^tow_seed_/ }).select("orderId");
  const previousOrderIds = previousPayments.map((p) => p.orderId).filter(Boolean);
  if (previousOrderIds.length > 0) {
    await Payment.deleteMany({ reference: /^tow_seed_/ });
    await Order.deleteMany({ _id: { $in: previousOrderIds } });
    console.log(`Removed ${previousOrderIds.length} previously-seeded order(s) + their payments.`);
  }

  const created: string[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const item = cartItems[i % cartItems.length];
    const subtotal = item.lineTotal;
    const discountAmount = scenario.discountAmount ?? 0;
    const effectiveSubtotal = Math.max(subtotal - discountAmount, 0);
    const serviceCharge = calculateServiceCharge(effectiveSubtotal);
    const totalAmount = effectiveSubtotal + serviceCharge;
    const now = new Date();

    const order = await Order.create({
      customerId: customerUser._id,
      vendorId: vendor._id,
      cartId: cart._id,
      currency: "NGN",
      items: [item],
      addressSnapshot,
      subtotal,
      serviceCharge,
      deliveryFee: 0,
      taxAmount: 0,
      discountAmount,
      totalAmount,
      status: scenario.status,
      paymentStatus: scenario.paymentStatus,
      cancellationReason: scenario.cancellationReason,
      paidAt: scenario.paidAt ? now : undefined,
      deliveredAt: scenario.deliveredAt ? now : undefined,
    });

    created.push(
      `${order._id.toString()}  status=${scenario.status}${scenario.cancellationReason ? ` (${scenario.cancellationReason})` : ""}  paymentStatus=${scenario.paymentStatus}  total=${totalAmount}`,
    );

    if (scenario.paymentStatus === "paid" || scenario.paymentStatus === "refunded") {
      const vendorNetAmount = Math.max(Math.round(effectiveSubtotal * 0.8), 0);
      const vendorGrossAmount = effectiveSubtotal;
      const vendorPlatformFeeAmount = effectiveSubtotal - vendorNetAmount;
      // Payment.status keeps its own (unaffected) vocabulary — "succeeded"
      // rather than Order.paymentStatus's "paid" — see payment.model.ts.
      const paymentModelStatus = scenario.paymentStatus === "paid" ? "succeeded" : "refunded";

      await Payment.create({
        context: "order",
        orderId: order._id,
        customerId: customerUser._id,
        vendorId: vendor._id,
        provider: "paystack",
        reference: `tow_seed_${order._id.toString()}`,
        amount: totalAmount,
        currency: "NGN",
        status: paymentModelStatus,
        vendorGrossAmount,
        vendorPlatformFeeAmount,
        vendorNetAmount,
        paidAt: now,
        settlementStatus: scenario.paymentStatus === "refunded" ? "reversed" : "unsettled",
        settlementEligibleAt: scenario.paymentStatus === "refunded" ? undefined : now,
      });
    }
  }

  console.log("\nCreated orders:");
  created.forEach((line) => console.log(`  ${line}`));
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
