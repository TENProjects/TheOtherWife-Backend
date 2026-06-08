/** @format */

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import Address from "../models/address.model.js";

const db = new Db();

// Populate the GeoJSON `location` field for addresses created before the
// 2dsphere index existed, so radius-based vendor search can reach them.
const backfillAddressLocation = async () => {
  const addresses = await Address.find({
    latitude: { $ne: null },
    longitude: { $ne: null },
    $or: [
      { location: { $exists: false } },
      { "location.coordinates": { $exists: false } },
      { "location.coordinates": { $size: 0 } },
    ],
  }).select("_id latitude longitude location");

  let updated = 0;
  let skipped = 0;

  for (const address of addresses) {
    if (
      typeof address.latitude !== "number" ||
      typeof address.longitude !== "number"
    ) {
      skipped += 1;
      continue;
    }

    address.location = {
      type: "Point",
      coordinates: [address.longitude, address.latitude],
    };

    await address.save();
    updated += 1;
  }

  return { scanned: addresses.length, updated, skipped };
};

const run = async () => {
  try {
    await db.connect();

    const result = await backfillAddressLocation();

    console.log("Address location backfill:", result);
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
