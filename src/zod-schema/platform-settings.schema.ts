/** @format */

import z from "zod";

export const updateNotificationSettingsSchema = z
  .object({
    orderStatusNotification: z.boolean().optional(),
    systemUpdatesNotification: z.boolean().optional(),
    promotionalNotification: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.orderStatusNotification !== undefined ||
      value.systemUpdatesNotification !== undefined ||
      value.promotionalNotification !== undefined,
    { message: "At least one field is required" },
  );

export const updateEmailSettingsSchema = z
  .object({
    customerPurchaseReceipts: z.boolean().optional(),
    customerPromotionalEmails: z.boolean().optional(),
    vendorSalesNotification: z.boolean().optional(),
    vendorCanceledOrderNotification: z.boolean().optional(),
    vendorRatingNotification: z.boolean().optional(),
    vendorPaymentNotification: z.boolean().optional(),
    adminFailedSubscriptionCharges: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "At least one field is required",
  });

export const updateAutomationSettingsSchema = z
  .object({
    abandonedTransactionsEnabled: z.boolean().optional(),
    abandonedCartsEnabled: z.boolean().optional(),
    reminderAfterHours: z.number().min(1).max(720).optional(),
    abandonedCartEmailSubject: z.string().trim().min(1).max(200).optional(),
    abandonedCartEmailBody: z.string().trim().min(1).max(5000).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "At least one field is required",
  });
