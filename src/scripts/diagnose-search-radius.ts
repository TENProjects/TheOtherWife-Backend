/** @format */

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import Address from "../models/address.model.js";
import Vendor from "../models/vendor.model.js";

const db = new Db();

const EARTH_RADIUS_KM = 6378.1;

// Haversine distance in km between two [lng, lat] points.
const distanceKm = (
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

const diagnose = async () => {
  const totalAddresses = await Address.countDocuments({});
  const addressesWithLocation = await Address.countDocuments({
    "location.coordinates.0": { $exists: true },
  });

  const approvedVendors = await Vendor.find({
    approvalStatus: "approved",
    isAvailable: { $ne: false },
  })
    .select("_id businessName addressId")
    .populate<{ addressId: any }>("addressId", "city state latitude longitude location");

  console.log("=== Address coverage ===");
  console.log("total addresses:", totalAddresses);
  console.log(
    "addresses with GeoJSON location:",
    addressesWithLocation,
    `(${totalAddresses - addressesWithLocation} missing -> invisible to radius search)`,
  );

  console.log("\n=== Approved + available vendors ===");
  console.log("count:", approvedVendors.length);

  let vendorsWithLocation = 0;

  // Reference point — pass as: tsx diagnose-search-radius.ts <lat> <lng> [radiusKm]
  const refLat = Number(process.argv[2]);
  const refLng = Number(process.argv[3]);
  const radiusKm = Number(process.argv[4]) || 25;
  const haveRef = Number.isFinite(refLat) && Number.isFinite(refLng);

  for (const vendor of approvedVendors) {
    const addr = vendor.addressId as any;
    const hasLocation = Array.isArray(addr?.location?.coordinates) && addr.location.coordinates.length === 2;
    if (hasLocation) vendorsWithLocation += 1;

    let distanceLabel = "";
    if (haveRef && typeof addr?.longitude === "number" && typeof addr?.latitude === "number") {
      const d = distanceKm(refLng, refLat, addr.longitude, addr.latitude);
      distanceLabel = ` | ${d.toFixed(1)} km from ref ${d <= radiusKm ? "✅ within" : "❌ outside"} ${radiusKm}km`;
    }

    console.log(
      `- ${vendor.businessName ?? "(no name)"} | addr: ${addr?.city ?? "?"}, ${addr?.state ?? "?"} | location: ${hasLocation ? "yes" : "MISSING"}${distanceLabel}`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(
    `vendors with location populated: ${vendorsWithLocation}/${approvedVendors.length}`,
  );
  if (haveRef) {
    console.log(`reference point: lat ${refLat}, lng ${refLng}, radius ${radiusKm}km`);
  } else {
    console.log("(pass <lat> <lng> [radiusKm] args to compute distances)");
  }
};

const run = async () => {
  try {
    await db.connect();
    await diagnose();
  } catch (error) {
    console.error("Diagnostic failed", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
