/** @format */

import z from "zod";

const cartOptionSelectionSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().min(0).optional(),
});

const cartOptionSelectionWithQuantitySchema = cartOptionSelectionSchema.extend({
  quantity: z.coerce.number().int().min(1).default(1),
});

export const addToCartSchema = z.object({
  quantity: z.coerce.number().int().min(1).optional(),
  customization: z
    .object({
      packaging: cartOptionSelectionSchema.optional(),
      spiceLevel: z.enum(["mild", "medium", "hot", "extra"]).optional(),
      proteinSelections: z.array(cartOptionSelectionWithQuantitySchema).optional(),
      addOnSelections: z.array(cartOptionSelectionSchema).optional(),
      drinkSelections: z.array(cartOptionSelectionWithQuantitySchema).optional(),
      customProteinRequests: z.array(z.string().trim().min(1)).optional(),
      customAddOnRequests: z.array(z.string().trim().min(1)).optional(),
      customDrinkRequests: z.array(z.string().trim().min(1)).optional(),
      cookingInstructions: z
        .object({
          presets: z.array(z.string().trim().min(1)).optional(),
          note: z.string().trim().max(500).optional(),
        })
        .optional(),
    })
    .optional(),
});
