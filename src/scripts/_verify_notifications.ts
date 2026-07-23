/** @format */
// Throwaway — verifies the Notification domain end-to-end, including the
// additive hooks in push-notification.signal.ts and support-ticket.service.ts.

import mongoose from "mongoose";
import { Db } from "../config/db.config.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import Notification from "../models/notification.model.js";
import { NotificationService } from "../services/notification.service.js";
import { SupportTicketService } from "../services/support-ticket.service.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import "../signals/push-notification.signal.js";

const CUSTOMER_EMAIL = "eseoghenedavid1@gmail.com";
const VENDOR_EMAIL = "theodoraishola@gmail.com";

async function main() {
  const db = new Db();
  await db.connect();
  console.log(`Connected to ${mongoose.connection.name}`);

  const customerUser = await User.findOne({ email: CUSTOMER_EMAIL });
  const vendorUser = await User.findOne({ email: VENDOR_EMAIL });
  const adminUser = await User.findOne({ userType: "admin" });
  if (!customerUser || !vendorUser || !adminUser) throw new Error("Seed users not found");
  const vendor = await Vendor.findOne({ userId: vendorUser._id });
  if (!vendor) throw new Error("Vendor profile not found");

  const notificationService = new NotificationService();

  // ── 1. Direct create + self-service list/read/delete ───────────────
  const created = await notificationService.create({
    recipientUserId: vendorUser._id.toString(),
    recipientType: "vendor",
    type: "system",
    title: "Test notification",
    body: "This is a throwaway test notification.",
  });
  console.log(`\n[Notifications] Created ${(created as any)._id}`);

  const list = await notificationService.getMyNotifications(vendorUser._id.toString(), {});
  console.log(`[Notifications] getMyNotifications: total=${list.pagination.total} unreadCount=${list.unreadCount}`);
  if (list.pagination.total < 1) throw new Error("Expected at least 1 notification");

  await notificationService.markAsRead(vendorUser._id.toString(), (created as any)._id.toString());
  const afterRead = await Notification.findById((created as any)._id);
  console.log(`[Notifications] After markAsRead: isRead=${afterRead?.isRead}`);
  if (!afterRead?.isRead) throw new Error("Expected isRead=true");

  await notificationService.deleteNotification(vendorUser._id.toString(), (created as any)._id.toString());
  const afterDelete = await Notification.findById((created as any)._id);
  console.log(`[Notifications] After delete: ${afterDelete ? "STILL EXISTS (bug)" : "gone as expected"}`);
  if (afterDelete) throw new Error("Expected notification to be deleted");

  // ── 2. Admin manual send ────────────────────────────────────────────
  const sent = await notificationService.sendManualNotification(adminUser._id.toString(), {
    recipientUserId: customerUser._id.toString(),
    recipientType: "customer",
    title: "Admin broadcast test",
    body: "Testing admin-sent notification.",
  });
  console.log(`\n[Notifications] Admin manual send OK, createdBy=${(sent as any).createdBy}`);
  await Notification.deleteOne({ _id: (sent as any)._id });

  // ── 3. Signal-driven persistence (order.status_changed) ────────────
  const before = await Notification.countDocuments({ recipientUserId: vendorUser._id });
  await appSignalDispatcher.emit("order.status_changed", {
    orderId: "000000000000000000000000",
    customerUserId: customerUser._id.toString(),
    vendorId: vendor._id.toString(),
    previousStatus: "confirmed",
    currentStatus: "preparing",
  });
  // Signal handlers run async (not awaited by emit) — give them a moment.
  await new Promise((res) => setTimeout(res, 1500));
  const after = await Notification.countDocuments({ recipientUserId: vendorUser._id });
  console.log(`\n[Signals] Vendor notifications before=${before} after=${after}`);
  if (after <= before) throw new Error("Expected order.status_changed to create a new vendor notification");

  // Clean up the signal-generated ones for both customer and vendor.
  await Notification.deleteMany({
    relatedEntityType: "Order",
    relatedEntityId: "000000000000000000000000",
  });
  console.log("[Signals] Cleaned up signal-generated test notifications.");

  // ── 4. Support ticket reply notifies the other party ────────────────
  const ticketService = new SupportTicketService();
  const ticket = await ticketService.createTicket(customerUser._id.toString(), {
    subject: "Notification wiring test",
    message: "Testing notification-on-reply.",
  });
  const ticketId = (ticket as any)._id.toString();

  const beforeAdminReplyNotif = await Notification.countDocuments({
    recipientUserId: customerUser._id,
    relatedEntityType: "SupportTicket",
    relatedEntityId: ticketId,
  });
  await ticketService.replyAsAdmin(adminUser._id.toString(), ticketId, "Looking into this.");
  const afterAdminReplyNotif = await Notification.countDocuments({
    recipientUserId: customerUser._id,
    relatedEntityType: "SupportTicket",
    relatedEntityId: ticketId,
  });
  console.log(`\n[Tickets->Notifications] Customer notifications before=${beforeAdminReplyNotif} after admin reply=${afterAdminReplyNotif}`);
  if (afterAdminReplyNotif <= beforeAdminReplyNotif) {
    throw new Error("Expected admin reply to notify the customer");
  }

  await Notification.deleteMany({ relatedEntityType: "SupportTicket", relatedEntityId: ticketId });
  await mongoose.connection.collection("supporttickets").deleteOne({ _id: new mongoose.Types.ObjectId(ticketId) });
  console.log("[Tickets->Notifications] Cleaned up.");
}

main()
  .then(() => console.log("\nAll notification checks passed."))
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
