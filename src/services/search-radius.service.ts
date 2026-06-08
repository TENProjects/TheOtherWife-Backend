/** @format */

import mongoose from "mongoose";
import Address from "../models/address.model.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import { searchRadiusKm } from "../constants/env.js";

// Mean Earth radius in kilometers, used to convert a distance into radians for
// MongoDB's $centerSphere geospatial query.
const EARTH_RADIUS_KM = 6378.1;
const DEFAULT_RADIUS_KM = 25;
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
  strategy: "radius" | "none";
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

export class SearchRadiusService {
  private resolveActiveCustomerAddress = async (userId?: string) => {
    if (!userId) {
      return null;
    }

    const customer = await Customer.findOne({ userId }).select("addressId");

    if (!customer) {
      return null;
    }

    const customerAddress =
      (customer.addressId
        ? await Address.findOne({
            _id: customer.addressId,
            userId,
          })
        : null) ??
      (await Address.findOne({ userId, isDefault: true }).sort({
        createdAt: -1,
      }));

    if (!customerAddress) {
      return null;
    }

    return customerAddress;
  };

  getVendorSearchContext = async (
    userId?: string,
    radiusKmOverride?: number,
  ): Promise<SearchRadiusContext> => {
    const customerAddress = await this.resolveActiveCustomerAddress(userId);

    // Without a usable customer location we cannot apply a radius, so we fall
    // back to the unfiltered result set (null vendorIds = "all vendors").
    if (
      !customerAddress ||
      typeof customerAddress.latitude !== "number" ||
      typeof customerAddress.longitude !== "number"
    ) {
      return {
        strategy: "none",
        customerAddress: null,
        vendorIds: null,
        radiusKm: null,
      };
    }

    const radiusKm = resolveRadiusKm(radiusKmOverride);

    const nearbyAddresses = await Address.find({
      location: {
        $geoWithin: {
          $centerSphere: [
            [customerAddress.longitude, customerAddress.latitude],
            radiusKm / EARTH_RADIUS_KM,
          ],
        },
      },
    }).select("_id");

    const nearbyAddressIds = nearbyAddresses.map((address) => address._id);

    const vendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
      addressId: { $in: nearbyAddressIds },
    }).select("_id");

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
      vendorIds: vendors.map((vendor) => vendor._id),
      radiusKm,
    };
  };
}
