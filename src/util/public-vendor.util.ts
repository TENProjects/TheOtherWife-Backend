/** @format */

import mongoose from "mongoose";
import { isPreciseCoordinate } from "./location-precision.util.js";

// Vendor fields that may appear in public (customer/anonymous) responses.
// Everything else on a Vendor document is private: bank/payout details, the
// Paystack subaccount, push tokens, onboarding documents, approval metadata,
// the owning userId. Populate with these — never the whole document.
export const PUBLIC_VENDOR_FIELDS =
  "businessName businessDescription businessLogoUrl approvalStatus isAvailable openingHours ratingAverage ratingCount ratingScore addressId";

// Address fields read for public responses. The exact coordinates are read
// only so they can be coarsened: a populated vendor address must always go
// through toPublicVendorArea() before it leaves the server.
export const PUBLIC_VENDOR_ADDRESS_FIELDS = "city state country latitude longitude";

// Before payment a customer sees the vendor's area plus an approximate
// position, snapped to a fixed grid of ~280 m cells: enough to show
// "2.4 km away", never enough to find the vendor's door. Snapping (unlike a
// random offset) is deterministic, so repeated or multi-point queries can't
// average it away. The exact street address is released only on the
// customer's own paid pick-up order (services/order-pickup.service.ts).
export const PUBLIC_LOCATION_GRID_DEGREES = 0.0025;
// Worst-case distance between a snapped point and the real one (half a
// cell's diagonal), rounded up.
export const PUBLIC_LOCATION_PRECISION_METERS = 200;

const snapToGrid = (value: number) =>
  Number(
    (
      Math.round(value / PUBLIC_LOCATION_GRID_DEGREES) *
      PUBLIC_LOCATION_GRID_DEGREES
    ).toFixed(4),
  );

export type PublicVendorArea = {
  city: string | null;
  state: string | null;
  country: string | null;
  // Approximate (grid-snapped) — see PUBLIC_LOCATION_GRID_DEGREES.
  latitude: number | null;
  longitude: number | null;
  locationPrecisionMeters: number | null;
};

export const toPublicVendorArea = (
  address:
    | {
        city?: string | null;
        state?: string | null;
        country?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      }
    | null
    | undefined,
): PublicVendorArea | null => {
  // An unpopulated ref (ObjectId) carries nothing public.
  if (!address || typeof address !== "object" || !("city" in address)) {
    return null;
  }

  // A position that was never geocoded (placeholder or state centroid) is
  // left out rather than shown as a misleading distance; the app then shows
  // the area instead.
  const hasLocation = isPreciseCoordinate(address.latitude, address.longitude);

  return {
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
    latitude: hasLocation ? snapToGrid(address.latitude as number) : null,
    longitude: hasLocation ? snapToGrid(address.longitude as number) : null,
    locationPrecisionMeters: hasLocation ? PUBLIC_LOCATION_PRECISION_METERS : null,
  };
};

// Replaces a populated vendor object's `addressId` with its public area
// (plain objects from toJSON/toObject/lean). A missing vendor or a bare,
// unpopulated id passes through untouched.
export const withPublicVendorArea = <T>(vendor: T): T => {
  if (
    !vendor ||
    typeof vendor !== "object" ||
    vendor instanceof mongoose.Types.ObjectId ||
    (vendor as { _bsontype?: string })._bsontype === "ObjectId"
  ) {
    return vendor;
  }

  return {
    ...(vendor as Record<string, unknown>),
    addressId: toPublicVendorArea((vendor as Record<string, any>).addressId),
  } as T;
};
