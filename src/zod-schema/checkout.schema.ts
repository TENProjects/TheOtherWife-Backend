/** @format */

import z from "zod";

export const checkoutPaymentProviderSchema = z.enum([
  "paystack",
  "cash",
  "wallet",
]);

// "pickup": the customer collects from the vendor. Defaults to "delivery"
// so older app builds (which never send it) keep their original behaviour.
export const fulfillmentTypeSchema = z.enum(["delivery", "pickup"]);

export const checkoutPreviewSchema = z.object({
  addressId: z.string().trim().min(1),
  promoCode: z.string().trim().min(1).optional(),
  fulfillmentType: fulfillmentTypeSchema.optional().default("delivery"),
});

export const checkoutConfirmSchema = z.object({
  addressId: z.string().trim().min(1),
  cartUpdatedAt: z.string().datetime(),
  useWallet: z.boolean().optional().default(false),
  paymentProvider: checkoutPaymentProviderSchema.optional().default("paystack"),
  promoCode: z.string().trim().min(1).optional(),
  fulfillmentType: fulfillmentTypeSchema.optional().default("delivery"),
});
