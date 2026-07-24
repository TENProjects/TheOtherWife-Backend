/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface PlatformSettingsDocument extends Document {
  orderStatusNotification: boolean;
  systemUpdatesNotification: boolean;
  promotionalNotification: boolean;

  customerPurchaseReceipts: boolean;
  customerPromotionalEmails: boolean;
  vendorSalesNotification: boolean;
  vendorCanceledOrderNotification: boolean;
  vendorRatingNotification: boolean;
  vendorPaymentNotification: boolean;
  adminFailedSubscriptionCharges: boolean;

  abandonedTransactionsEnabled: boolean;
  abandonedCartsEnabled: boolean;
  reminderAfterHours: number;
  abandonedCartEmailSubject: string;
  abandonedCartEmailBody: string;

  updatedBy?: mongoose.Types.ObjectId;
}

// Singleton document — there is only ever one PlatformSettings record,
// fetched/created via PlatformSettingsService.getOrCreateSettings(),
// mirroring FinancialSettings's getOrCreateSettings() pattern exactly.
const PlatformSettingsSchema = new Schema(
  {
    orderStatusNotification: { type: Boolean, required: true, default: true },
    systemUpdatesNotification: { type: Boolean, required: true, default: true },
    promotionalNotification: { type: Boolean, required: true, default: false },

    customerPurchaseReceipts: { type: Boolean, required: true, default: true },
    customerPromotionalEmails: { type: Boolean, required: true, default: true },
    vendorSalesNotification: { type: Boolean, required: true, default: true },
    vendorCanceledOrderNotification: { type: Boolean, required: true, default: true },
    vendorRatingNotification: { type: Boolean, required: true, default: true },
    vendorPaymentNotification: { type: Boolean, required: true, default: true },
    adminFailedSubscriptionCharges: { type: Boolean, required: true, default: true },

    abandonedTransactionsEnabled: { type: Boolean, required: true, default: true },
    abandonedCartsEnabled: { type: Boolean, required: true, default: true },
    reminderAfterHours: { type: Number, required: true, min: 1, default: 24 },
    abandonedCartEmailSubject: {
      type: String,
      required: true,
      default: "Don't forget your order!",
    },
    abandonedCartEmailBody: {
      type: String,
      required: true,
      default:
        "Hi {customer_name}, we noticed you left items in your cart. Complete your order now and enjoy your meal!",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

export default model<PlatformSettingsDocument>(
  "PlatformSettings",
  PlatformSettingsSchema,
);
