/** @format */

import z from "zod";

export const updateReviewStatusSchema = z.object({
  moderationStatus: z.enum(["visible", "hidden"]),
});
