/** @format */

import Counter from "../models/counter.model.js";

// Atomically issues the next value in a named sequence, creating it at 0
// (then incrementing to 1) on first use — safe under concurrent requests
// since the increment happens in a single findOneAndUpdate.
export const nextSequence = async (sequenceName: string): Promise<number> => {
  const counter = await Counter.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return counter.seq;
};
