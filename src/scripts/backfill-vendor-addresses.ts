/** @format */

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import Vendor from "../models/vendor.model.js";
import Address from "../models/address.model.js";
import { getStateCentroidCoordinates } from "../util/nigeria-state-coordinates.util.js";

// One-time backfill: onboarding step 1 historically only ever wrote a
// vendor's address into additionalData.location (a loose JSON blob) and
// never created a real Address document or set Vendor.addressId — so
// anything reading vendor.addressId (Personal Details on the vendor app,
// the admin vendor-relations screen, "vendors near me" radius search) saw
// nothing for every vendor that onboarded before this fix. This creates the
// missing Address document from each affected vendor's additionalData.location
// and links it. Precise coordinates were never captured for these existing
// vendors, so this uses a state-capital centroid as an approximation — new
// vendors onboarding after this fix get precise geocoded coordinates
// directly from vendor-onboarding.service.ts's createStep1.
const backfillVendorAddresses = async () => {
  const vendors = await Vendor.find({
    $or: [{ addressId: { $exists: false } }, { addressId: null }],
  }).select("_id userId additionalData addressId");

  let updated = 0;
  let skippedNoLocation = 0;

  for (const vendor of vendors) {
    const location = (vendor.additionalData as any)?.location;
    const state: string | undefined = location?.state;
    const city: string | undefined = location?.city;

    if (!state || !city) {
      skippedNoLocation += 1;
      continue;
    }

    const coordinates = getStateCentroidCoordinates(state);

    const address = await Address.create({
      userId: vendor.userId,
      label: "work",
      address: location?.address,
      city,
      state,
      country: "Nigeria",
      postalCode: "000000",
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      isDefault: true,
    });

    vendor.addressId = address._id as any;
    await vendor.save();
    updated += 1;
  }

  return { scanned: vendors.length, updated, skippedNoLocation };
};

async function main() {
  const db = new Db();
  await db.connect();

  const result = await backfillVendorAddresses();

  console.log("Vendor address backfill:", result);
}

main()
  .then(() => console.log("Backfill complete."))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
