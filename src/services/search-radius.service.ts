/** @format */

import mongoose from "mongoose";
import Address from "../models/address.model.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import { searchRadiusKm } from "../constants/env.js";
import { isPreciseCoordinate } from "../util/location-precision.util.js";

// Mean Earth radius in kilometers, used to convert a distance into radians for
// MongoDB's $centerSphere geospatial query.
const EARTH_RADIUS_KM = 6378.1;
// Customers see only HomeChefs within 0–5 km of their set location (business
// rule). SEARCH_RADIUS_KM and a customer-chosen radius can narrow it, never
// widen it past MAX_RADIUS_KM.
const DEFAULT_RADIUS_KM = 5;
// Bounds for a customer-selected search width (e.g. a 10 / 20 / 50 km control).
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 5;

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
  // radius:            HomeChefs within radiusKm of the customer's location
  // location_required: a customer with no usable location (no address, or
  //                    one never placed on the map) — nothing is "near" yet
  // none:              not a customer request (anonymous/vendor/admin
  //                    browsing), unfiltered as before
  strategy: "radius" | "location_required" | "none";
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
    if (!userId) {
      return NO_FILTER;
    }

    const radiusKm = resolveRadiusKm(radiusKmOverride);
    const customerAddress = await this.resolveActiveCustomerAddress(userId);

    // A customer sees only HomeChefs near their set location. Without a
    // position to measure from there is nothing to show until they set one
    // (the app prompts for it) — never every vendor everywhere.
    if (
      !customerAddress ||
      !isPreciseCoordinate(customerAddress.latitude, customerAddress.longitude)
    ) {
      return {
        strategy: "location_required",
        customerAddress: null,
        vendorIds: [],
        radiusKm,
      };
    }

    const vendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
      addressId: { $exists: true, $ne: null },
    })
      .select("_id addressId")
      .lean();
    const vendorAddressIds = vendors.map((vendor) => vendor.addressId);

    const withinRadius = await Address.find({
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
      .lean();

    // Only HomeChefs whose address has a real position. One that was never
    // geocoded (the app's old placeholder or a state-capital centroid) can't
    // be shown as "near" anyone until the vendor sets their address.
    const matchedAddressIds = new Set(
      withinRadius
        .filter((address) => isPreciseCoordinate(address.latitude, address.longitude))
        .map((address) => address._id.toString()),
    );

    const matchedVendorIds = vendors
      .filter(
        (vendor) =>
          vendor.addressId &&
          matchedAddressIds.has(vendor.addressId.toString()),
      )
      .map((vendor) => vendor._id as mongoose.Types.ObjectId);

    return {
      strategy: "radius",
      customerAddress: {
        id: customerAddress._id.toString(),
        city: customerAddress.city,
        state: customerAddress.state,
        country: customerAddress.country,
        latitude: customerAddress.latitude,
        longitude: customerAddress.longitude,
      },
      vendorIds: matchedVendorIds,
      radiusKm,
    };
  };
}
