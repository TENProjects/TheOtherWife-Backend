/** @format */

import { isStateCentroidCoordinate } from "./nigeria-state-coordinates.util.js";

// The point the app used to save whenever an address was typed without
// picking a search result, dropping the pin or using GPS. It marks "location
// unknown", not a real place.
export const APP_PLACEHOLDER_COORDINATES = {
  latitude: 6.44115,
  longitude: 3.47352,
} as const;

// True only for a real geocode. Rejects malformed values, (0, 0), the app's
// old placeholder and the state-capital centroids the server substitutes
// when a vendor address arrives without coordinates — those say which state
// an address is in, nothing about distance.
export const isPreciseCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean => {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return false;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return false;
  }

  if (latitude === 0 && longitude === 0) {
    return false;
  }

  if (
    latitude === APP_PLACEHOLDER_COORDINATES.latitude &&
    longitude === APP_PLACEHOLDER_COORDINATES.longitude
  ) {
    return false;
  }

  return !isStateCentroidCoordinate(latitude, longitude);
};
