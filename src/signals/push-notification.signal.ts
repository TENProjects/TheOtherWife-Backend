/** @format */

import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import Customer from "../models/customer.model.js";
import Vendor from "../models/vendor.model.js";
import { PushNotificationService } from "../services/push-notification.service.js";
import { NotificationService } from "../services/notification.service.js";

const pushNotificationService = new PushNotificationService();
// Persists an in-app notification record alongside the existing push send —
// additive only. The push-sending behavior above/below is unchanged; this
// just also gives the Notifications screen something to read from, which
// didn't exist before (push notifications were previously fire-and-forget,
// nothing was ever stored).
const notificationService = new NotificationService();

appSignalDispatcher.on("order.created", async (payload) => {
  const vendor = await Vendor.findById(payload.vendorId).select(
    "userId expoTokens pushNotificationsEnabled",
  );

  if (!vendor) return;

  const title = "New order received";
  const body = `Order #${payload.orderId.slice(-6)} for ${payload.currency} ${payload.totalAmount} is waiting for your action.`;

  await notificationService.create({
    recipientUserId: vendor.userId.toString(),
    recipientType: "vendor",
    type: "order_update",
    title,
    body,
    relatedEntityType: "Order",
    relatedEntityId: payload.orderId,
  });

  if (vendor.pushNotificationsEnabled === false) return;

  await pushNotificationService.sendToTokens(vendor.expoTokens ?? [], {
    title,
    body,
    data: {
      type: "order_created",
      orderId: payload.orderId,
    },
  });
});

appSignalDispatcher.on("order.status_changed", async (payload) => {
  const [customer, vendor] = await Promise.all([
    Customer.findOne({ userId: payload.customerUserId }).select(
      "userId expoTokens pushNotificationsEnabled",
    ),
    Vendor.findById(payload.vendorId).select(
      "userId expoTokens pushNotificationsEnabled",
    ),
  ]);

  if (customer) {
    const title = "Order update";
    const body = `Order #${payload.orderId.slice(-6)} changed from ${payload.previousStatus} to ${payload.currentStatus}.`;

    await notificationService.create({
      recipientUserId: payload.customerUserId,
      recipientType: "customer",
      type: "order_update",
      title,
      body,
      relatedEntityType: "Order",
      relatedEntityId: payload.orderId,
    });

    if (customer.pushNotificationsEnabled !== false) {
      await pushNotificationService.sendToTokens(customer.expoTokens ?? [], {
        title,
        body,
        data: {
          type: "order_status_changed",
          orderId: payload.orderId,
          previousStatus: payload.previousStatus,
          currentStatus: payload.currentStatus,
        },
      });
    }
  }

  if (vendor) {
    const title = "Order status updated";
    const body = `Order #${payload.orderId.slice(-6)} is now ${payload.currentStatus}.`;

    await notificationService.create({
      recipientUserId: vendor.userId.toString(),
      recipientType: "vendor",
      type: "order_update",
      title,
      body,
      relatedEntityType: "Order",
      relatedEntityId: payload.orderId,
    });

    if (vendor.pushNotificationsEnabled !== false) {
      await pushNotificationService.sendToTokens(vendor.expoTokens ?? [], {
        title,
        body,
        data: {
          type: "order_status_changed",
          orderId: payload.orderId,
          currentStatus: payload.currentStatus,
        },
      });
    }
  }
});

appSignalDispatcher.on("vendor.approved", async (payload) => {
  const vendor = await Vendor.findById(payload.vendorId).select(
    "expoTokens pushNotificationsEnabled",
  );

  const title = "Vendor account approved";
  const body =
    "Your vendor profile has been approved by admin. You can now receive orders.";

  await notificationService.create({
    recipientUserId: payload.vendorUserId,
    recipientType: "vendor",
    type: "vendor_approval",
    title,
    body,
    relatedEntityType: "Vendor",
    relatedEntityId: payload.vendorId,
  });

  if (!vendor || vendor.pushNotificationsEnabled === false) return;

  await pushNotificationService.sendToTokens(vendor.expoTokens ?? [], {
    title,
    body,
    data: {
      type: "vendor_approved",
      vendorId: payload.vendorId,
    },
  });
});
