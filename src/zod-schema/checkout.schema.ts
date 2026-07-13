/** @format */

import z from "zod";

export const checkoutPaymentProviderSchema = z.enum([
  "paystack",
  "cash",
  "wallet",
]);

export const checkoutPreviewSchema = z.object({
  addressId: z.string().trim().min(1),
  promoCode: z.string().trim().min(1).optional(),
});

export const checkoutConfirmSchema = z.object({
  addressId: z.string().trim().min(1),
  cartUpdatedAt: z.string().datetime(),
  useWallet: z.boolean().optional().default(false),
  paymentProvider: checkoutPaymentProviderSchema.optional().default("paystack"),
  promoCode: z.string().trim().min(1).optional(),
});
