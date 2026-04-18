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
    _userId?: string,
  ): Promise<SearchRadiusContext> => {
    // Temporarily disabled: keep service contract without applying radius filters.
    return {
      strategy: "none",
      customerAddress: null,
      vendorIds: null,
    };
  };
}
