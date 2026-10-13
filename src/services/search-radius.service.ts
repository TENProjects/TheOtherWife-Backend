/** @format */

import mongoose from "mongoose";
import Address from "../models/address.model.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import { searchRadiusKm } from "../constants/env.js";
import { isPreciseCoordinate } from "../util/location-precision.util.js";
import { escapeRegex } from "../util/regex.util.js";

// Mean Earth radius in kilometers, used to convert a distance into radians for
// MongoDB's $centerSphere geospatial query.
const EARTH_RADIUS_KM = 6378.1;
// "Close proximity" for home-cooked food in a dense city. Overridable per
// environment with SEARCH_RADIUS_KM.
const DEFAULT_RADIUS_KM = 10;
// Bounds for a customer-selected search width (e.g. a 10 / 20 / 50 km control).
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 100;

export const resolveRadiusKm = (radiusKmOverride?: number): number => {
  const fallback = searchRadiusKm > 0 ? searchRadiusKm : DEFAULT_RADIUS_KM;
  const requested =
    typeof radiusKmOverride === "number" &&
    Number.isFinite(radiusKmOverride) &&
    radiusKmOverride > 0
      ? radiusKmOverride
      : fallback;

  return Math.min(Math.max(requested, MIN_RADIUS_KM), MAX_RADIUS_KM);
};

type SearchRadiusContext = {
  // radius: by distance from the customer's location
  // city:   the customer's address was never geocoded, so by city name
  // none:   no saved address, so unfiltered
  strategy: "radius" | "city" | "none";
  customerAddress: null | {
    id: string;
    city: string;
    state: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  vendorIds: mongoose.Types.ObjectId[] | null;
  radiusKm: number | null;
};

const NO_FILTER: SearchRadiusContext = {
  strategy: "none",
  customerAddress: null,
  vendorIds: null,
  radiusKm: null,
};

export class SearchRadiusService {
  // The customer's "set location": the same address the app shows as the
  // delivery location — the default address, else the most recently added
  // one (the app's address list is sorted the same way). Customer.addressId
  // isn't used: it follows the most recently *created* address and drifts
  // from the default as soon as a customer has two.
  private resolveActiveCustomerAddress = async (userId?: string) => {
    if (!userId) {
      return null;
    }

    const isCustomer = await Customer.exists({ userId });

    if (!isCustomer) {
      return null;
    }

    return Address.findOne({ userId }).sort({ isDefault: -1, createdAt: -1 });
  };

  getVendorSearchContext = async (
    userId?: string,
    radiusKmOverride?: number,
  ): Promise<SearchRadiusContext> => {
    const customerAddress = await this.resolveActiveCustomerAddress(userId);

    if (!customerAddress) {
      return NO_FILTER;
    }

    const hasPreciseLocation = isPreciseCoordinate(
      customerAddress.latitude,
      customerAddress.longitude,
    );
    const city =
      typeof customerAddress.city === "string"
        ? customerAddress.city.trim().slice(0, 100)
        : "";

    // Nothing to measure from and no area to match on.
    if (!hasPreciseLocation && !city) {
      return NO_FILTER;
    }

    const radiusKm = resolveRadiusKm(radiusKmOverride);

    const vendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
      addressId: { $exists: true, $ne: null },
    })
      .select("_id addressId")
      .lean();
    const vendorAddressIds = vendors.map((vendor) => vendor.addressId);

    const [withinRadius, inSameCity] = await Promise.all([
      hasPreciseLocation
        ? Address.find({
            _id: { $in: vendorAddressIds },
            location: {
              $geoWithin: {
                $centerSphere: [
                  [customerAddress.longitude, customerAddress.latitude],
                  radiusKm / EARTH_RADIUS_KM,
                ],
              },
            },
          })
            .select("_id latitude longitude")
            .lean()
        : Promise.resolve([]),
      city
        ? Address.find({
            _id: { $in: vendorAddressIds },
            // Case-insensitive exact match; the city is escaped, never
            // interpreted as a pattern.
            city: { $regex: `^\\s*${escapeRegex(city)}\\s*$`, $options: "i" },
          })
            .select("_id latitude longitude")
            .lean()
        : Promise.resolve([]),
    ]);

    const matchedAddressIds = new Set<string>();

    // Vendors with a real geocode: by distance.
    for (const address of withinRadius) {
      if (isPreciseCoordinate(address.latitude, address.longitude)) {
        matchedAddressIds.add(address._id.toString());
      }
    }

    // A vendor whose address was never geocoded (placeholder or state
    // centroid) can't be placed by distance, so it's matched by city — and
    // when the customer's own position is unknown, city is all there is.
    for (const address of inSameCity) {
      if (
        !hasPreciseLocation ||
        !isPreciseCoordinate(address.latitude, address.longitude)
      ) {
        matchedAddressIds.add(address._id.toString());
      }
    }

    const matchedVendorIds = vendors
      .filter(
        (vendor) =>
          vendor.addressId &&
          matchedAddressIds.has(vendor.addressId.toString()),
      )
      .map((vendor) => vendor._id as mongoose.Types.ObjectId);

    return {
      strategy: hasPreciseLocation ? "radius" : "city",
      customerAddress: {
        id: customerAddress._id.toString(),
        city: customerAddress.city,
        state: customerAddress.state,
        country: customerAddress.country,
        latitude: customerAddress.latitude,
        longitude: customerAddress.longitude,
      },
      vendorIds: matchedVendorIds,
      radiusKm: hasPreciseLocation ? radiusKm : null,
    };
  };
}
