/** @format */
// Verifies (orders/payments/addresses) then deletes 2 named accounts.

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import Address from "../models/address.model.js";

const EMAILS = [
  "agbohelen126@gmail.com",
  "kmexconsult@gmail.com",
  "esedavid74@gmail.com",
];

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  for (const email of EMAILS) {
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`\n${email}: not found, skipping.`);
      continue;
    }

    console.log(`\n${email}: userType=${user.userType} status=${user.status} createdAt=${user.createdAt}`);

    const [customer, vendor, addresses] = await Promise.all([
      Customer.findOne({ userId: user._id }),
      Vendor.findOne({ userId: user._id }),
      Address.find({ userId: user._id }),
    ]);

    const [ordersAsCustomer, ordersAsVendor, paymentsAsCustomer] = await Promise.all([
      Order.countDocuments({ customerId: user._id }),
      vendor ? Order.countDocuments({ vendorId: vendor._id }) : Promise.resolve(0),
      Payment.countDocuments({ customerId: user._id }),
    ]);

    const hasReferences =
      ordersAsCustomer > 0 || ordersAsVendor > 0 || paymentsAsCustomer > 0;

    console.log(`  Customer profile: ${customer ? customer._id.toString() : "none"}`);
    console.log(`  Vendor profile: ${vendor ? `${vendor._id.toString()} (businessName=${vendor.businessName}, approvalStatus=${vendor.approvalStatus})` : "none"}`);
    console.log(`  orders(customer)=${ordersAsCustomer} orders(vendor)=${ordersAsVendor} payments=${paymentsAsCustomer} addresses=${addresses.length}`);

    if (hasReferences) {
      console.log(`  SKIPPING deletion — has referenced order/payment data.`);
      continue;
    }

    const results = await Promise.all([
      Customer.deleteOne({ userId: user._id }),
      Vendor.deleteOne({ userId: user._id }),
      Address.deleteMany({ userId: user._id }),
      User.deleteOne({ _id: user._id }),
    ]);
    console.log(`  Deleted: customer=${results[0].deletedCount} vendor=${results[1].deletedCount} addresses=${results[2].deletedCount} user=${results[3].deletedCount}`);
  }
}

main()
  .then(() => console.log("\nDone."))
  .catch((err) => {
    console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
