/** @format */

// Approximate state-capital coordinates, used as a fallback centroid when a
// vendor's onboarding submission doesn't include a precise geocoded
// latitude/longitude (e.g. the client's Google Places lookup failed, or an
// address was entered without selecting a suggestion). Good enough for
// city-level "vendors near me" radius search; not a substitute for a real
// geocode when one is available.
const STATE_CAPITAL_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  abia: { latitude: 5.5333, longitude: 7.4833 }, // Umuahia
  adamawa: { latitude: 9.3265, longitude: 12.3984 }, // Yola
  "akwa ibom": { latitude: 5.0377, longitude: 7.9128 }, // Uyo
  anambra: { latitude: 6.2209, longitude: 7.0721 }, // Awka
  bauchi: { latitude: 10.3158, longitude: 9.8442 }, // Bauchi
  bayelsa: { latitude: 4.9247, longitude: 6.2642 }, // Yenagoa
  benue: { latitude: 7.7322, longitude: 8.5391 }, // Makurdi
  borno: { latitude: 11.8333, longitude: 13.15 }, // Maiduguri
  "cross river": { latitude: 4.9589, longitude: 8.3269 }, // Calabar
  delta: { latitude: 6.2, longitude: 6.7333 }, // Asaba
  ebonyi: { latitude: 6.3248, longitude: 8.1137 }, // Abakaliki
  edo: { latitude: 6.335, longitude: 5.6037 }, // Benin City
  ekiti: { latitude: 7.6211, longitude: 5.2211 }, // Ado-Ekiti
  enugu: { latitude: 6.4413, longitude: 7.4988 }, // Enugu
  "fct - abuja": { latitude: 9.0765, longitude: 7.3986 }, // Abuja
  fct: { latitude: 9.0765, longitude: 7.3986 },
  abuja: { latitude: 9.0765, longitude: 7.3986 },
  gombe: { latitude: 10.2897, longitude: 11.1673 }, // Gombe
  imo: { latitude: 5.4836, longitude: 7.0333 }, // Owerri
  jigawa: { latitude: 12.2266, longitude: 9.5624 }, // Dutse
  kaduna: { latitude: 10.5222, longitude: 7.4383 }, // Kaduna
  kano: { latitude: 12.0022, longitude: 8.592 }, // Kano
  katsina: { latitude: 12.9908, longitude: 7.6018 }, // Katsina
  kebbi: { latitude: 12.4539, longitude: 4.1975 }, // Birnin Kebbi
  kogi: { latitude: 7.7337, longitude: 6.6906 }, // Lokoja
  kwara: { latitude: 8.4966, longitude: 4.5426 }, // Ilorin
  lagos: { latitude: 6.5244, longitude: 3.3792 }, // Ikeja
  nasarawa: { latitude: 8.4933, longitude: 8.5167 }, // Lafia
  niger: { latitude: 9.6139, longitude: 6.5569 }, // Minna
  ogun: { latitude: 7.1475, longitude: 3.3619 }, // Abeokuta
  ondo: { latitude: 7.2526, longitude: 5.2059 }, // Akure
  osun: { latitude: 7.7719, longitude: 4.5561 }, // Osogbo
  oyo: { latitude: 7.3775, longitude: 3.947 }, // Ibadan
  plateau: { latitude: 9.8965, longitude: 8.8583 }, // Jos
  rivers: { latitude: 4.8156, longitude: 7.0498 }, // Port Harcourt
  sokoto: { latitude: 13.0059, longitude: 5.2476 }, // Sokoto
  taraba: { latitude: 8.8833, longitude: 11.3667 }, // Jalingo
  yobe: { latitude: 11.7469, longitude: 11.9661 }, // Damaturu
  zamfara: { latitude: 12.1704, longitude: 6.2642 }, // Gusau
};

const DEFAULT_COORDINATES = STATE_CAPITAL_COORDINATES.lagos;

export const getStateCentroidCoordinates = (
  state?: string,
): { latitude: number; longitude: number } => {
  if (!state) return DEFAULT_COORDINATES;
  const key = state.trim().toLowerCase();
  return STATE_CAPITAL_COORDINATES[key] ?? DEFAULT_COORDINATES;
};
