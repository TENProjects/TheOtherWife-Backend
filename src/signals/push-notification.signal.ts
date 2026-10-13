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

// A vendor hears about an order only once it has been PAID. Orders exist as
// "pending_payment" while the customer is still on the Paystack page; an
// abandoned or failed checkout must never reach the vendor.
appSignalDispatcher.on("order.paid", async (payload) => {
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
      // Kept as "order_created" for compatibility with existing app builds.
      type: "order_created",
      orderId: payload.orderId,
    },
  });
});

// Human wording for raw status values in notification copy.
const STATUS_LABELS: Record<string, string> = {
  pending_payment: "awaiting payment",
  paid: "paid",
  confirmed: "confirmed",
  preparing: "being prepared",
  out_for_delivery: "out for delivery",
  delivered: "delivered",
  cancelled: "cancelled",
};
const statusLabel = (status: string) =>
  STATUS_LABELS[status] ?? status.replace(/_/g, " ");

appSignalDispatcher.on("order.status_changed", async (payload) => {
  // Transitions out of "pending_payment" are payment outcomes. The vendor
  // was never told about the order before it was paid, so: a successful
  // payment is announced by "order.paid" ("New order received"), and a
  // failed/expired payment is none of the vendor's business.
  const notifyVendor = payload.previousStatus !== "pending_payment";

  const [customer, vendor] = await Promise.all([
    Customer.findOne({ userId: payload.customerUserId }).select(
      "userId expoTokens pushNotificationsEnabled",
    ),
    notifyVendor
      ? Vendor.findById(payload.vendorId).select(
          "userId expoTokens pushNotificationsEnabled",
        )
      : Promise.resolve(null),
  ]);

  if (customer) {
    const title = "Order update";
    const body =
      payload.previousStatus === "pending_payment" && payload.currentStatus === "cancelled"
        ? `Payment for order #${payload.orderId.slice(-6)} was not completed, so the order was cancelled.`
        : `Order #${payload.orderId.slice(-6)} is now ${statusLabel(payload.currentStatus)}.`;

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
    const body = `Order #${payload.orderId.slice(-6)} is now ${statusLabel(payload.currentStatus)}.`;

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

appSignalDispatcher.on("order.payment_received_after_expiry", async (payload) => {
  const customer = await Customer.findOne({ userId: payload.customerUserId }).select(
    "userId expoTokens pushNotificationsEnabled",
  );
  if (!customer) return;

  const title = "Payment received — refund on the way";
  const body = `We received ${payload.currency} ${payload.amount} for order #${payload.orderId.slice(-6)} after it had already been cancelled for non-payment. The order was not sent to the vendor, and a refund to your TOW wallet has been opened.`;

  await notificationService.create({
    recipientUserId: payload.customerUserId,
    recipientType: "customer",
    type: "order_update",
    title,
    body,
    relatedEntityType: "Order",
    relatedEntityId: payload.orderId,
  });

  if (customer.pushNotificationsEnabled === false) return;

  await pushNotificationService.sendToTokens(customer.expoTokens ?? [], {
    title,
    body,
    data: { type: "order_payment_after_expiry", orderId: payload.orderId },
  });
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
