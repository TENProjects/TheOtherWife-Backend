/** @format */

export const weekdayKeys = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type WeekdayKey = (typeof weekdayKeys)[number];

export type DailyOpeningHours = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

export type VendorOpeningHours = Record<WeekdayKey, DailyOpeningHours>;

export type VendorOrderReceivingContext = {
  approvalStatus?: string | null;
  isAvailable?: boolean | null;
  openingHours?: VendorOpeningHours | null;
};

const defaultDailyOpeningHours: DailyOpeningHours = {
  isOpen: true,
  openTime: "00:00",
  closeTime: "23:59",
};

export const defaultVendorOpeningHours: VendorOpeningHours = {
  monday: { ...defaultDailyOpeningHours },
  tuesday: { ...defaultDailyOpeningHours },
  wednesday: { ...defaultDailyOpeningHours },
  thursday: { ...defaultDailyOpeningHours },
  friday: { ...defaultDailyOpeningHours },
  saturday: { ...defaultDailyOpeningHours },
  sunday: { ...defaultDailyOpeningHours },
};

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (time: string) => {
  if (!timePattern.test(time)) {
    return null;
  }

  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const jsWeekdayMap: Record<number, WeekdayKey> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export const isVendorOpenAt = (
  openingHours: VendorOpeningHours | null | undefined,
  now: Date = new Date(),
) => {
  const normalizedHours = openingHours ?? defaultVendorOpeningHours;
  const weekdayKey = jsWeekdayMap[now.getDay()];
  const dailyHours = normalizedHours[weekdayKey];

  if (!dailyHours?.isOpen) {
    return false;
  }

  const openMinutes = toMinutes(dailyHours.openTime);
  const closeMinutes = toMinutes(dailyHours.closeTime);

  if (openMinutes === null || closeMinutes === null) {
    return false;
  }

  if (openMinutes === closeMinutes) {
    return true;
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (closeMinutes > openMinutes) {
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }

  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
};

export const isVendorReceivingOrders = (
  vendor: VendorOrderReceivingContext,
  now: Date = new Date(),
) => {
  return (
    vendor.approvalStatus === "approved" &&
    vendor.isAvailable !== false &&
    isVendorOpenAt(vendor.openingHours, now)
  );
};
