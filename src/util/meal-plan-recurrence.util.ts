/** @format */

export type MealPlanFrequency = "daily" | "weekdays" | "weekends" | "custom";

const weekdayKeys = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const weekdaySet = new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);
const weekendSet = new Set(["saturday", "sunday"]);

/**
 * Generates one Date per delivery day between startDate and endDate
 * (inclusive), filtered by frequency. Dates are compared by calendar day
 * only (time-of-day is stripped).
 */
export const generateDeliveryDates = (
  startDate: Date,
  endDate: Date,
  frequency: MealPlanFrequency,
  customDays?: string[],
): Date[] => {
  const dates: Date[] = [];
  const normalizedCustomDays = new Set(
    (customDays ?? []).map((day) => day.toLowerCase()),
  );

  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()),
  );

  while (cursor.getTime() <= end.getTime()) {
    const dayName = weekdayKeys[cursor.getUTCDay()];
    const included =
      frequency === "daily"
        ? true
        : frequency === "weekdays"
          ? weekdaySet.has(dayName)
          : frequency === "weekends"
            ? weekendSet.has(dayName)
            : normalizedCustomDays.has(dayName);

    if (included) {
      dates.push(new Date(cursor));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

/**
 * Combines a calendar date with an "HH:mm" time string into a single Date,
 * used to compute edit/cancel cutoffs for a scheduled meal.
 */
export const combineDateAndTime = (date: Date, time: string): Date => {
  const [hours, minutes] = time.split(":").map(Number);
  const combined = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  combined.setUTCHours(hours, minutes, 0, 0);
  return combined;
};
