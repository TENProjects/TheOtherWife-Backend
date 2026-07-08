/** @format */

export const spiceLevels = ["mild", "medium", "hot", "extra"] as const;

export type SpiceLevel = (typeof spiceLevels)[number];
