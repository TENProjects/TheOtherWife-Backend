/** @format */

import z from "zod";

export const createBlogPostSchema = z.object({
  title: z.string().trim().min(1),
  featuredImageUrl: z.string().trim().optional(),
  content: z.string().trim().min(1),
  quote: z.string().trim().max(500).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
});

export const updateBlogPostSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    featuredImageUrl: z.string().trim().optional(),
    content: z.string().trim().min(1).optional(),
    quote: z.string().trim().max(500).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: "At least one field is required" },
  );
