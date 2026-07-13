/** @format */

import { ClientSession } from "mongoose";
import ScheduledMeal, {
  ScheduledMealDocument,
} from "../models/scheduledMeal.model.js";
import MealPlan from "../models/mealPlan.model.js";
import Address from "../models/address.model.js";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import { transaction } from "../util/transaction.util.js";
import { combineDateAndTime } from "../util/meal-plan-recurrence.util.js";
import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import { VendorWalletService } from "./vendor-wallet.service.js";

// How far ahead of a scheduled meal's delivery window it turns into a real,
// vendor-visible Order — the vendor then Accepts/Mark-Readys/Delivers it
// through the exact same flow as any other order. This is the ideal target
// once the cron runs frequently (e.g. every 15 min on Vercel Pro / a real
// cron daemon on Digital Ocean).
export const MEAL_PLAN_FULFILLMENT_LEAD_HOURS = 3;

// TEMPORARY: Vercel's Hobby plan only allows once-a-day cron schedules (see
// vercel.json), so a single run must catch everything due before the NEXT
// run — otherwise meals due later the same day would only get converted
// after their delivery window has already passed. Once running on a more
// frequent scheduler (Digital Ocean), lower this back down to match
// MEAL_PLAN_FULFILLMENT_LEAD_HOURS by deleting this override.
const CRON_INTERVAL_SAFETY_HOURS = 26;
export const EFFECTIVE_LEAD_HOURS = Math.max(
  MEAL_PLAN_FULFILLMENT_LEAD_HOURS,
  CRON_INTERVAL_SAFETY_HOURS,
);

export class MealPlanFulfillmentService {
  private vendorWalletService: VendorWalletService;

  constructor() {
    this.vendorWalletService = new VendorWalletService();
  }

  // Converts one due ScheduledMeal into a real Order + Payment pair so it
  // enters the vendor's normal Accept/Preparing/Out-for-delivery/Delivered
  // queue (and its push notifications) unchanged. The money was already
  // collected upfront via the plan's batch payment (MealPlanService
  // .addMealToPlan) — this Payment is a bookkeeping record, not a new
  // charge, but it deliberately mirrors a real succeeded order payment
  // exactly (context "order", vendorGrossAmount/vendorNetAmount via
  // syncPaymentSettlementFromOrder) so vendor wallet settlement, refund
  // Scenario A (vendor-reject), and admin profit reporting all work on it
  // with zero special-casing.
  private convertOne = async (scheduledMeal: ScheduledMealDocument) => {
    const result = await transaction.use(async (session: ClientSession) => {
      const freshScheduledMeal = await ScheduledMeal.findOne({
        _id: scheduledMeal._id,
        orderId: { $exists: false },
      }).session(session);

      // Already converted by a concurrent run, or cancelled since being
      // queried — nothing to do.
      if (!freshScheduledMeal || freshScheduledMeal.status !== "scheduled") {
        return null;
      }

      const plan = await MealPlan.findById(freshScheduledMeal.planId).session(
        session,
      );
      if (!plan) return null;

      const address = await Address.findById(plan.addressId).session(session);
      if (!address) return null;

      const price = freshScheduledMeal.price;

      const [order] = await Order.create(
        [
          {
            customerId: freshScheduledMeal.customerId,
            vendorId: freshScheduledMeal.vendorId,
            currency: plan.currency,
            items: [
              {
                mealId: freshScheduledMeal.mealId,
                mealName: freshScheduledMeal.mealName,
                quantity: 1,
                unitPrice: price,
                lineTotal: price,
              },
            ],
            addressSnapshot: {
              label: address.label,
              address: address.address,
              city: address.city,
              state: address.state,
              country: address.country,
              postalCode: address.postalCode,
              latitude: address.latitude,
              longitude: address.longitude,
            },
            subtotal: price,
            serviceCharge: 0,
            deliveryFee: 0,
            taxAmount: 0,
            discountAmount: 0,
            totalAmount: price,
            walletAmountApplied: 0,
            paystackAmountDue: 0,
            status: "paid",
            paymentStatus: "succeeded",
            paidAt: new Date(),
          },
        ],
        { session },
      );

      const [payment] = await Payment.create(
        [
          {
            context: "order",
            orderId: order._id,
            customerId: freshScheduledMeal.customerId,
            vendorId: freshScheduledMeal.vendorId,
            provider: "paystack",
            reference: `tow_mp_fulfill_${freshScheduledMeal._id.toString()}`,
            amount: price,
            currency: plan.currency,
            status: "succeeded",
            paidAt: new Date(),
            providerPayload: {
              sourceMealPlanId: plan._id.toString(),
              sourceMealPlanPaymentId: freshScheduledMeal.paymentId?.toString(),
              scheduledMealId: freshScheduledMeal._id.toString(),
            },
          },
        ],
        { session },
      );

      await this.vendorWalletService.syncPaymentSettlementFromOrder(
        session,
        payment._id.toString(),
      );

      freshScheduledMeal.orderId = order._id;
      await freshScheduledMeal.save({ session });

      return { order, scheduledMeal: freshScheduledMeal };
    })();

    if (!result) return;

    await appSignalDispatcher.emit("order.created", {
      orderId: result.order._id.toString(),
      customerUserId: result.scheduledMeal.customerId.toString(),
      vendorId: result.scheduledMeal.vendorId.toString(),
      totalAmount: result.order.totalAmount,
      currency: result.order.currency,
    });
  };

  // Entry point for the cron-triggered internal endpoint. Finds every
  // unconverted scheduled meal due within the lead time (including overdue
  // ones — those still need converting, they just also show up "at risk" in
  // admin monitoring) and converts each independently so one failure never
  // blocks the rest of the batch.
  processDueScheduledMeals = async () => {
    const candidates = await ScheduledMeal.find({
      status: "scheduled",
      paymentStatus: "succeeded",
      orderId: { $exists: false },
    });

    const cutoff = Date.now() + EFFECTIVE_LEAD_HOURS * 60 * 60 * 1000;
    const due = candidates.filter(
      (scheduledMeal) =>
        combineDateAndTime(
          scheduledMeal.deliveryDate,
          scheduledMeal.deliveryTimeWindow.startTime,
        ).getTime() <= cutoff,
    );

    let converted = 0;
    let failed = 0;
    for (const scheduledMeal of due) {
      try {
        await this.convertOne(scheduledMeal);
        converted += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Failed to convert scheduled meal ${scheduledMeal._id.toString()} to an order:`,
          error,
        );
      }
    }

    return { checked: due.length, converted, failed };
  };
}
