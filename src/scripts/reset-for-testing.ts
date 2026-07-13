/** @format */

// One-time production reset for a fresh full-platform test pass.
// Wipes every collection except whatever belongs to a single preserved
// account (by email), then creates a clean customer/vendor/admin trio with
// the vendor pre-approved. Run with: npx tsx src/scripts/reset-for-testing.ts

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";

import Address from "../models/address.model.js";
import AdminAuditLog from "../models/adminAuditLog.model.js";
import BlogPost from "../models/blogPost.model.js";
import Cart from "../models/cart.model.js";
import Category from "../models/category.model.js";
import Customer from "../models/customer.model.js";
import Favourites from "../models/favourites.model.js";
import FinancialSettings from "../models/financialSettings.model.js";
import Meal from "../models/meal.model.js";
import MealCategory, { CategoryType } from "../models/mealCategory.model.js";
import MealPlan from "../models/mealPlan.model.js";
import MealReview from "../models/mealReview.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import PromoCampaign from "../models/promoCampaign.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import ScheduledMeal from "../models/scheduledMeal.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import VendorCallLog from "../models/vendorCallLog.model.js";
import VendorIssue from "../models/vendorIssue.model.js";
import VendorMessage from "../models/vendorMessage.model.js";
import VendorPayoutAllocation from "../models/vendorPayoutAllocation.model.js";
import VendorPayoutRequest from "../models/vendorPayoutRequest.model.js";
import VendorWarning from "../models/vendorWarning.model.js";
import Wallet from "../models/wallet.model.js";
import WalletTransaction from "../models/walletTransaction.model.js";

const PRESERVE_EMAIL = "coachteedee@gmail.com";
const DEFAULT_PASSWORD = "TestPass123!";

const NEW_ACCOUNTS = {
  customer: {
    email: "eseoghenedavid1@gmail.com",
    firstName: "Eseoghene",
    lastName: "David",
    phoneNumber: "+2347025841122",
  },
  vendor: {
    email: "theodoraishola@gmail.com",
    firstName: "Theodora",
    lastName: "Ishola",
    phoneNumber: "+2348037089600",
  },
  admin: {
    email: "admin@theotherwife.com",
    firstName: "Admin",
    lastName: "User",
  },
};

const db = new Db();

const idsOf = (docs: { _id: mongoose.Types.ObjectId }[]) => docs.map((d) => d._id);

async function main() {
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const preservedUser = await User.findOne({ email: PRESERVE_EMAIL });
  if (!preservedUser) {
    throw new Error(
      `Preserve-target user "${PRESERVE_EMAIL}" was not found — aborting without deleting anything.`,
    );
  }
  console.log(`Preserving account: ${preservedUser.email} (${preservedUser.userType}, ${preservedUser._id})`);

  const preservedVendor = await Vendor.findOne({ userId: preservedUser._id });
  const preservedCustomer = await Customer.findOne({ userId: preservedUser._id });
  const preservedAddresses = await Address.find({ userId: preservedUser._id });

  const preservedMeals = preservedVendor
    ? await Meal.find({ vendorId: preservedVendor._id })
    : [];

  const ownerIds = [
    preservedUser._id,
    ...(preservedVendor ? [preservedVendor._id] : []),
  ];

  const preservedOrders = await Order.find({
    $or: [
      { customerId: preservedUser._id },
      ...(preservedVendor ? [{ vendorId: preservedVendor._id }] : []),
    ],
  });
  const preservedPayments = await Payment.find({
    $or: [
      { customerId: preservedUser._id },
      ...(preservedVendor ? [{ vendorId: preservedVendor._id }] : []),
    ],
  });
  const preservedCarts = await Cart.find({ customerId: preservedUser._id });
  const preservedFavourites = await Favourites.find({ customerId: preservedUser._id });
  const preservedMealPlans = await MealPlan.find({ customerId: preservedUser._id });
  const preservedScheduledMeals = await ScheduledMeal.find({ customerId: preservedUser._id });
  const preservedPayoutRequests = preservedVendor
    ? await VendorPayoutRequest.find({ vendorId: preservedVendor._id })
    : [];
  const preservedPayoutAllocations = preservedVendor
    ? await VendorPayoutAllocation.find({ vendorId: preservedVendor._id })
    : [];
  const preservedWallets = await Wallet.find({ userId: preservedUser._id });
  const preservedWalletTransactions = preservedWallets.length
    ? await WalletTransaction.find({ walletId: { $in: idsOf(preservedWallets) } })
    : [];

  console.log("Preserved records:", {
    vendorProfile: !!preservedVendor,
    customerProfile: !!preservedCustomer,
    addresses: preservedAddresses.length,
    meals: preservedMeals.length,
    orders: preservedOrders.length,
    payments: preservedPayments.length,
    carts: preservedCarts.length,
    favourites: preservedFavourites.length,
    mealPlans: preservedMealPlans.length,
    scheduledMeals: preservedScheduledMeals.length,
    payoutRequests: preservedPayoutRequests.length,
    payoutAllocations: preservedPayoutAllocations.length,
    wallets: preservedWallets.length,
    walletTransactions: preservedWalletTransactions.length,
  });

  // ── Wipe everything not explicitly preserved above ──────────────────────
  await User.deleteMany({ _id: { $ne: preservedUser._id } });
  await Vendor.deleteMany({ _id: { $nin: preservedVendor ? [preservedVendor._id] : [] } });
  await Customer.deleteMany({ _id: { $nin: preservedCustomer ? [preservedCustomer._id] : [] } });
  await Address.deleteMany({ _id: { $nin: idsOf(preservedAddresses) } });
  await Meal.deleteMany({ _id: { $nin: idsOf(preservedMeals) } });
  await Order.deleteMany({ _id: { $nin: idsOf(preservedOrders) } });
  await Payment.deleteMany({ _id: { $nin: idsOf(preservedPayments) } });
  await Cart.deleteMany({ _id: { $nin: idsOf(preservedCarts) } });
  await Favourites.deleteMany({ _id: { $nin: idsOf(preservedFavourites) } });
  await MealPlan.deleteMany({ _id: { $nin: idsOf(preservedMealPlans) } });
  await ScheduledMeal.deleteMany({ _id: { $nin: idsOf(preservedScheduledMeals) } });
  await VendorPayoutRequest.deleteMany({ _id: { $nin: idsOf(preservedPayoutRequests) } });
  await VendorPayoutAllocation.deleteMany({ _id: { $nin: idsOf(preservedPayoutAllocations) } });
  await Wallet.deleteMany({ _id: { $nin: idsOf(preservedWallets) } });
  await WalletTransaction.deleteMany({ _id: { $nin: idsOf(preservedWalletTransactions) } });

  // Collections with no ownership relationship to any single account —
  // always fully cleared.
  await MealReview.deleteMany({});
  await PromoCampaign.deleteMany({});
  await AdminAuditLog.deleteMany({});
  await RefundRequest.deleteMany({});
  await FinancialSettings.deleteMany({});
  await BlogPost.deleteMany({});
  await VendorIssue.deleteMany({});
  await VendorWarning.deleteMany({});
  await VendorMessage.deleteMany({});
  await VendorCallLog.deleteMany({});
  await Category.deleteMany({});

  // MealCategory is reference/taxonomy data (not user data) that meal
  // creation depends on — reseed it rather than leaving it empty.
  await MealCategory.deleteMany({});
  const categories = await MealCategory.insertMany(
    Object.values(CategoryType).map((categoryValue) => ({
      category: categoryValue,
      description: `${categoryValue} category`,
    })),
  );
  console.log(`Reseeded ${categories.length} meal categories`);

  console.log("Wipe complete.");

  // ── Create the three clean test accounts ────────────────────────────────
  const [adminUser] = await User.create([
    {
      firstName: NEW_ACCOUNTS.admin.firstName,
      lastName: NEW_ACCOUNTS.admin.lastName,
      email: NEW_ACCOUNTS.admin.email,
      passwordHash: DEFAULT_PASSWORD,
      userType: "admin",
      authType: "email",
      isEmailVerified: true,
      isPhoneVerified: true,
      status: "active",
    },
  ]);

  const [customerUser] = await User.create([
    {
      firstName: NEW_ACCOUNTS.customer.firstName,
      lastName: NEW_ACCOUNTS.customer.lastName,
      email: NEW_ACCOUNTS.customer.email,
      phoneNumber: NEW_ACCOUNTS.customer.phoneNumber,
      passwordHash: DEFAULT_PASSWORD,
      userType: "customer",
      authType: "email",
      isEmailVerified: true,
      isPhoneVerified: true,
      status: "active",
    },
  ]);
  // Location-based vendor discovery (SearchRadiusService) needs a resolvable
  // address with lat/long on both sides — without one, it silently falls
  // back to showing every vendor, which would make the feature look broken
  // during testing even though it works correctly once addresses exist.
  const [customerAddress] = await Address.create([
    {
      userId: customerUser._id,
      label: "home",
      address: "18 Fola Osibo Road",
      city: "Lekki",
      state: "Lagos",
      country: "Nigeria",
      postalCode: "101241",
      latitude: 6.4351,
      longitude: 3.4509,
      isDefault: true,
    },
  ]);
  await Customer.create([{ userId: customerUser._id, addressId: customerAddress._id }]);

  const [vendorUser] = await User.create([
    {
      firstName: NEW_ACCOUNTS.vendor.firstName,
      lastName: NEW_ACCOUNTS.vendor.lastName,
      email: NEW_ACCOUNTS.vendor.email,
      phoneNumber: NEW_ACCOUNTS.vendor.phoneNumber,
      passwordHash: DEFAULT_PASSWORD,
      userType: "vendor",
      authType: "email",
      isEmailVerified: true,
      isPhoneVerified: true,
      status: "active",
    },
  ]);
  // ~2.4km from the customer's address above, well within the default 25km
  // search radius, so the new vendor is actually discoverable during testing.
  const [vendorAddress] = await Address.create([
    {
      userId: vendorUser._id,
      label: "work",
      address: "12 Admiralty Way",
      city: "Lekki",
      state: "Lagos",
      country: "Nigeria",
      postalCode: "101233",
      latitude: 6.4474,
      longitude: 3.4723,
      isDefault: true,
    },
  ]);
  const [vendorProfile] = await Vendor.create([
    {
      userId: vendorUser._id,
      addressId: vendorAddress._id,
      approvalStatus: "approved",
      approvedBy: adminUser._id,
      approvedAt: new Date(),
    },
  ]);

  console.log("Created accounts:");
  console.log(`  Admin:    ${adminUser.email} / ${DEFAULT_PASSWORD}`);
  console.log(`  Customer: ${customerUser.email} / ${DEFAULT_PASSWORD}`);
  console.log(`  Vendor:   ${vendorUser.email} / ${DEFAULT_PASSWORD} (approvalStatus=${vendorProfile.approvalStatus})`);
}

main()
  .then(() => console.log("Reset complete."))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
