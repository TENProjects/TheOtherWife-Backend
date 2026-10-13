/** @format */

import mongoose from "mongoose";
import Vendor from "../models/vendor.model.js";
import { isCustomerVisibleOrder } from "../util/order-visibility.util.js";

export type PickupLocation = {
  businessName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  openingHours: unknown;
};

type PickupEligibleOrder = {
  fulfillmentType?: string;
  paymentStatus?: string;
  status?: string;
  vendorId: unknown;
};

const toObjectId = (value: unknown): mongoose.Types.ObjectId | null => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (value && typeof value === "object" && "_id" in value) {
    return toObjectId((value as { _id: unknown })._id);
  }
  if (typeof value === "string" && mongoose.isValidObjectId(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
};

// The vendor's exact street address is shared ONLY with a customer who has
// paid for a pick-up order (and never on a cancelled one). Public endpoints
// (meals, vendor profiles, cart) expose city/state only.
export const getPickupLocationForOrder = async (
  order: PickupEligibleOrder,
): Promise<PickupLocation | null> => {
  if (order.fulfillmentType !== "pickup") return null;
  if (!isCustomerVisibleOrder(order) || order.status === "cancelled") return null;

  const vendorId = toObjectId(order.vendorId);
  if (!vendorId) return null;

  const vendor = await Vendor.findById(vendorId)
    .select("businessName openingHours addressId")
    .populate("addressId", "address city state country")
    .lean<{
      businessName?: string;
      openingHours?: unknown;
      addressId?: { address?: string; city?: string; state?: string; country?: string } | null;
    }>();
  if (!vendor) return null;

  const address = vendor.addressId ?? null;
  return {
    businessName: vendor.businessName ?? null,
    address: address?.address ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    country: address?.country ?? null,
    openingHours: vendor.openingHours ?? null,
  };
};
