/** @format */

import MealPlan from "../models/mealPlan.model.js";
import ScheduledMeal from "../models/scheduledMeal.model.js";
import Order from "../models/order.model.js";
import { combineDateAndTime } from "../util/meal-plan-recurrence.util.js";
import { MEAL_PLAN_FULFILLMENT_LEAD_HOURS } from "./meal-plan-fulfillment.service.js";

// How far past its delivery-window start an unresolved scheduled meal is
// still shown, so admins can see recently-missed ones without the list
// growing unbounded with ancient history.
const OVERDUE_LOOKBACK_HOURS = 48;
// How far ahead of the delivery-window start an on-track (already converted,
// not yet due) scheduled meal is still worth surfacing to admins as "upcoming".
const UPCOMING_WINDOW_HOURS = 24;

export class AdminMealPlanService {
  // Read-only monitoring list (no admin edit/cancel actions here by design —
  // this only needs to let admins watch plans and their scheduled meals).
  listActivePlans = async (filters: { page?: number; limit?: number } = {}) => {
    const { page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const [plans, total] = await Promise.all([
      MealPlan.find({ status: "active" })
        .populate("customerId", "firstName lastName email phoneNumber")
        .populate("vendorId", "businessName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      MealPlan.countDocuments({ status: "active" }),
    ]);

    const planIds = plans.map((plan) => plan._id);
    const nextScheduledMeals = await ScheduledMeal.find({
      planId: { $in: planIds },
      status: "scheduled",
      deliveryDate: { $gte: new Date() },
    })
      .sort({ deliveryDate: 1 })
      .select("planId deliveryDate deliveryTimeWindow");

    const nextByPlan = new Map<string, { deliveryDate: Date; deliveryTimeWindow: unknown }>();
    for (const scheduledMeal of nextScheduledMeals) {
      const key = scheduledMeal.planId.toString();
      if (!nextByPlan.has(key)) {
        nextByPlan.set(key, {
          deliveryDate: scheduledMeal.deliveryDate,
          deliveryTimeWindow: scheduledMeal.deliveryTimeWindow,
        });
      }
    }

    return {
      plans: plans.map((plan) => ({
        ...plan.toObject(),
        nextScheduledMeal: nextByPlan.get(plan._id.toString()) ?? null,
      })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  };

  // The actionable view: scheduled meals that need a human's eyes on them
  // right now — due soon or overdue and either not yet converted into an
  // order, or converted but the vendor hasn't progressed it in time.
  getScheduledMealMonitor = async () => {
    const now = Date.now();
    const overdueFloor = new Date(now - OVERDUE_LOOKBACK_HOURS * 60 * 60 * 1000);
    const upcomingCeiling = new Date(
      now + Math.max(MEAL_PLAN_FULFILLMENT_LEAD_HOURS, UPCOMING_WINDOW_HOURS) * 60 * 60 * 1000,
    );

    const scheduledMeals = await ScheduledMeal.find({
      status: "scheduled",
      deliveryDate: { $gte: overdueFloor, $lte: upcomingCeiling },
    })
      .populate("customerId", "firstName lastName email")
      .populate("vendorId", "businessName")
      .populate("planId", "name")
      .sort({ deliveryDate: 1 });

    const orderIds = scheduledMeals
      .map((meal) => meal.orderId)
      .filter((id): id is NonNullable<typeof id> => !!id);
    const orders = await Order.find({ _id: { $in: orderIds } }).select(
      "status",
    );
    const orderStatusById = new Map(
      orders.map((order) => [order._id.toString(), order.status]),
    );

    const items = scheduledMeals.map((meal) => {
      const windowStart = combineDateAndTime(
        meal.deliveryDate,
        meal.deliveryTimeWindow.startTime,
      ).getTime();
      const hoursToWindow = (windowStart - now) / (60 * 60 * 1000);
      const linkedOrderStatus = meal.orderId
        ? orderStatusById.get(meal.orderId.toString())
        : undefined;

      let flag: string;
      if (!meal.orderId) {
        flag =
          hoursToWindow <= 0
            ? "overdue_not_converted"
            : hoursToWindow <= MEAL_PLAN_FULFILLMENT_LEAD_HOURS
              ? "due_soon_not_yet_converted"
              : "on_track";
      } else if (
        linkedOrderStatus &&
        !["preparing", "out_for_delivery", "delivered"].includes(linkedOrderStatus) &&
        hoursToWindow <= 0
      ) {
        flag = "vendor_action_overdue";
      } else if (
        linkedOrderStatus &&
        linkedOrderStatus === "paid" &&
        hoursToWindow <= 1
      ) {
        flag = "vendor_hasnt_accepted";
      } else {
        flag = "on_track";
      }

      return {
        scheduledMealId: meal._id,
        planName: (meal.planId as any)?.name,
        customer: meal.customerId,
        vendor: meal.vendorId,
        mealName: meal.mealName,
        deliveryDate: meal.deliveryDate,
        deliveryTimeWindow: meal.deliveryTimeWindow,
        orderId: meal.orderId ?? null,
        orderStatus: linkedOrderStatus ?? null,
        flag,
      };
    });

    return {
      items,
      atRiskCount: items.filter((item) => item.flag !== "on_track").length,
    };
  };
}
