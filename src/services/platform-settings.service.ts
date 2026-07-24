/** @format */

import mongoose from "mongoose";
import PlatformSettings from "../models/platformSettings.model.js";

export class PlatformSettingsService {
  private getOrCreateSettings = async () => {
    let settings = await PlatformSettings.findOne();
    if (!settings) {
      settings = await PlatformSettings.create({});
    }
    return settings;
  };

  getNotificationSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      orderStatusNotification: settings.orderStatusNotification,
      systemUpdatesNotification: settings.systemUpdatesNotification,
      promotionalNotification: settings.promotionalNotification,
    };
  };

  updateNotificationSettings = async (
    payload: {
      orderStatusNotification?: boolean;
      systemUpdatesNotification?: boolean;
      promotionalNotification?: boolean;
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();

    if (payload.orderStatusNotification !== undefined) {
      settings.orderStatusNotification = payload.orderStatusNotification;
    }
    if (payload.systemUpdatesNotification !== undefined) {
      settings.systemUpdatesNotification = payload.systemUpdatesNotification;
    }
    if (payload.promotionalNotification !== undefined) {
      settings.promotionalNotification = payload.promotionalNotification;
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      orderStatusNotification: settings.orderStatusNotification,
      systemUpdatesNotification: settings.systemUpdatesNotification,
      promotionalNotification: settings.promotionalNotification,
    };
  };

  getEmailSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      customerPurchaseReceipts: settings.customerPurchaseReceipts,
      customerPromotionalEmails: settings.customerPromotionalEmails,
      vendorSalesNotification: settings.vendorSalesNotification,
      vendorCanceledOrderNotification: settings.vendorCanceledOrderNotification,
      vendorRatingNotification: settings.vendorRatingNotification,
      vendorPaymentNotification: settings.vendorPaymentNotification,
      adminFailedSubscriptionCharges: settings.adminFailedSubscriptionCharges,
    };
  };

  updateEmailSettings = async (
    payload: {
      customerPurchaseReceipts?: boolean;
      customerPromotionalEmails?: boolean;
      vendorSalesNotification?: boolean;
      vendorCanceledOrderNotification?: boolean;
      vendorRatingNotification?: boolean;
      vendorPaymentNotification?: boolean;
      adminFailedSubscriptionCharges?: boolean;
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();

    if (payload.customerPurchaseReceipts !== undefined) {
      settings.customerPurchaseReceipts = payload.customerPurchaseReceipts;
    }
    if (payload.customerPromotionalEmails !== undefined) {
      settings.customerPromotionalEmails = payload.customerPromotionalEmails;
    }
    if (payload.vendorSalesNotification !== undefined) {
      settings.vendorSalesNotification = payload.vendorSalesNotification;
    }
    if (payload.vendorCanceledOrderNotification !== undefined) {
      settings.vendorCanceledOrderNotification = payload.vendorCanceledOrderNotification;
    }
    if (payload.vendorRatingNotification !== undefined) {
      settings.vendorRatingNotification = payload.vendorRatingNotification;
    }
    if (payload.vendorPaymentNotification !== undefined) {
      settings.vendorPaymentNotification = payload.vendorPaymentNotification;
    }
    if (payload.adminFailedSubscriptionCharges !== undefined) {
      settings.adminFailedSubscriptionCharges = payload.adminFailedSubscriptionCharges;
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      customerPurchaseReceipts: settings.customerPurchaseReceipts,
      customerPromotionalEmails: settings.customerPromotionalEmails,
      vendorSalesNotification: settings.vendorSalesNotification,
      vendorCanceledOrderNotification: settings.vendorCanceledOrderNotification,
      vendorRatingNotification: settings.vendorRatingNotification,
      vendorPaymentNotification: settings.vendorPaymentNotification,
      adminFailedSubscriptionCharges: settings.adminFailedSubscriptionCharges,
    };
  };

  getAutomationSettings = async () => {
    const settings = await this.getOrCreateSettings();
    return {
      abandonedTransactionsEnabled: settings.abandonedTransactionsEnabled,
      abandonedCartsEnabled: settings.abandonedCartsEnabled,
      reminderAfterHours: settings.reminderAfterHours,
      abandonedCartEmailSubject: settings.abandonedCartEmailSubject,
      abandonedCartEmailBody: settings.abandonedCartEmailBody,
    };
  };

  updateAutomationSettings = async (
    payload: {
      abandonedTransactionsEnabled?: boolean;
      abandonedCartsEnabled?: boolean;
      reminderAfterHours?: number;
      abandonedCartEmailSubject?: string;
      abandonedCartEmailBody?: string;
    },
    adminUserId: string,
  ) => {
    const settings = await this.getOrCreateSettings();

    if (payload.abandonedTransactionsEnabled !== undefined) {
      settings.abandonedTransactionsEnabled = payload.abandonedTransactionsEnabled;
    }
    if (payload.abandonedCartsEnabled !== undefined) {
      settings.abandonedCartsEnabled = payload.abandonedCartsEnabled;
    }
    if (payload.reminderAfterHours !== undefined) {
      settings.reminderAfterHours = payload.reminderAfterHours;
    }
    if (payload.abandonedCartEmailSubject !== undefined) {
      settings.abandonedCartEmailSubject = payload.abandonedCartEmailSubject;
    }
    if (payload.abandonedCartEmailBody !== undefined) {
      settings.abandonedCartEmailBody = payload.abandonedCartEmailBody;
    }

    settings.updatedBy = new mongoose.Types.ObjectId(adminUserId);
    await settings.save();

    return {
      abandonedTransactionsEnabled: settings.abandonedTransactionsEnabled,
      abandonedCartsEnabled: settings.abandonedCartsEnabled,
      reminderAfterHours: settings.reminderAfterHours,
      abandonedCartEmailSubject: settings.abandonedCartEmailSubject,
      abandonedCartEmailBody: settings.abandonedCartEmailBody,
    };
  };
}
