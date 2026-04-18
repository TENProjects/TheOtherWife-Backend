/** @format */

import mongoose from "mongoose";
import Address from "../models/address.model.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import { isVendorReceivingOrders } from "../util/vendor-opening-hours.util.js";

type SearchRadiusContext = {
  strategy: "same_city_placeholder" | "none";
  customerAddress: null | {
    id: string;
    city: string;
    state: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  vendorIds: mongoose.Types.ObjectId[] | null;
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
  ): Promise<SearchRadiusContext> => {
    const customerAddress = await this.resolveActiveCustomerAddress(userId);

    if (!customerAddress) {
      return {
        strategy: "none",
        customerAddress: null,
        vendorIds: null,
      };
    }

    const nearbyAddressIds = await Address.find({
      city: customerAddress.city,
      state: customerAddress.state,
      country: customerAddress.country,
    }).distinct("_id");

    const nearbyVendors = await Vendor.find({
      approvalStatus: "approved",
      isAvailable: { $ne: false },
      addressId: { $in: nearbyAddressIds },
    }).select("_id openingHours");

    const nearbyVendorIds = nearbyVendors
      .filter((vendor) => isVendorReceivingOrders(vendor))
      .map((vendor) => vendor._id);

    return {
      strategy: "same_city_placeholder",
      customerAddress: {
        id: customerAddress._id.toString(),
        city: customerAddress.city,
        state: customerAddress.state,
        country: customerAddress.country,
        latitude: customerAddress.latitude,
        longitude: customerAddress.longitude,
      },
      vendorIds: nearbyVendorIds as mongoose.Types.ObjectId[],
    };
  };
}
