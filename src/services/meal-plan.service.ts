/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import MealPlan, { MealPlanCustomization, MealPlanTimeWindow } from "../models/mealPlan.model.js";
import ScheduledMeal from "../models/scheduledMeal.model.js";
import Meal from "../models/meal.model.js";
import {
  combineDateAndTime,
  generateDeliveryDates,
} from "../util/meal-plan-recurrence.util.js";

const EDIT_CUTOFF_HOURS = 12;
const MONTHLY_DISCOUNT_RATE = 0.1;

export class MealPlanService {
  private ensureEditableWindow = (
    deliveryDate: Date,
    deliveryTimeWindow: MealPlanTimeWindow,
  ) => {
    const cutoff = new Date(
      combineDateAndTime(deliveryDate, deliveryTimeWindow.startTime).getTime() -
        EDIT_CUTOFF_HOURS * 60 * 60 * 1000,
    );

    if (Date.now() > cutoff.getTime()) {
      throw new BadRequestException(
        `This meal can no longer be edited or cancelled (must be done at least ${EDIT_CUTOFF_HOURS} hours before delivery)`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  private summarizePlan = (
    plan: { toObject: () => Record<string, any> },
    scheduledMeals: { price: number }[],
  ) => {
    const totalAmount = scheduledMeals.reduce(
      (total, meal) => total + meal.price,
      0,
    );
    const plainPlan = plan.toObject();
    const estimatedTotal =
      plainPlan.paymentType === "monthly"
        ? Number((totalAmount * (1 - MONTHLY_DISCOUNT_RATE)).toFixed(2))
        : totalAmount;

    return {
      ...plainPlan,
      mealsScheduledCount: scheduledMeals.length,
      totalAmount,
      estimatedTotal,
    };
  };

  createPlan = async (
    userId: string,
    data: {
      name: string;
      frequency: "daily" | "weekdays" | "weekends" | "custom";
      customDays?: string[];
      startDate: Date;
      endDate: Date;
      deliveryTimeWindow: MealPlanTimeWindow;
      defaultCustomization: MealPlanCustomization;
      paymentType: "weekly" | "monthly" | "per_meal";
    },
  ) => {
    const plan = await MealPlan.create({
      customerId: userId,
      name: data.name,
      frequency: data.frequency,
      customDays: data.customDays,
      startDate: data.startDate,
      endDate: data.endDate,
      deliveryTimeWindow: data.deliveryTimeWindow,
      defaultCustomization: data.defaultCustomization,
      paymentType: data.paymentType,
    });

    return this.summarizePlan(plan, []);
  };

  updatePlan = async (
    userId: string,
    planId: string,
    data: {
      name?: string;
      frequency?: "daily" | "weekdays" | "weekends" | "custom";
      customDays?: string[];
      startDate?: Date;
      endDate?: Date;
      deliveryTimeWindow?: MealPlanTimeWindow;
      defaultCustomization?: MealPlanCustomization;
      paymentType?: "weekly" | "monthly" | "per_meal";
    },
  ) => {
    const plan = await MealPlan.findOne({ _id: planId, customerId: userId });

    if (!plan) {
      throw new NotFoundException(
        "Meal plan not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (data.name !== undefined) plan.name = data.name;
    if (data.frequency !== undefined) plan.frequency = data.frequency;
    if (data.customDays !== undefined) plan.customDays = data.customDays;
    if (data.startDate !== undefined) plan.startDate = data.startDate;
    if (data.endDate !== undefined) plan.endDate = data.endDate;
    if (data.deliveryTimeWindow !== undefined)
      plan.deliveryTimeWindow = data.deliveryTimeWindow;
    if (data.defaultCustomization !== undefined)
      plan.defaultCustomization = data.defaultCustomization;
    if (data.paymentType !== undefined) plan.paymentType = data.paymentType;

    await plan.save();

    const scheduledMeals = await ScheduledMeal.find({
      planId: plan._id,
      status: { $ne: "cancelled" },
    }).select("price");

    return this.summarizePlan(plan, scheduledMeals);
  };

  cancelPlan = async (userId: string, planId: string) => {
    const plan = await MealPlan.findOne({ _id: planId, customerId: userId });

    if (!plan) {
      throw new NotFoundException(
        "Meal plan not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    plan.status = "cancelled";
    await plan.save();

    await ScheduledMeal.updateMany(
      {
        planId: plan._id,
        status: "scheduled",
        deliveryDate: { $gte: new Date() },
      },
      { $set: { status: "cancelled", cancelledAt: new Date() } },
    );

    const scheduledMeals = await ScheduledMeal.find({
      planId: plan._id,
      status: { $ne: "cancelled" },
    }).select("price");

    return this.summarizePlan(plan, scheduledMeals);
  };

  addMealToPlan = async (
    userId: string,
    planId: string,
    data: { mealId: string; customization?: MealPlanCustomization },
  ) => {
    const plan = await MealPlan.findOne({ _id: planId, customerId: userId });

    if (!plan) {
      throw new NotFoundException(
        "Meal plan not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (plan.status !== "active") {
      throw new BadRequestException(
        "Cannot add meals to a cancelled plan",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const meal = await Meal.findOne({
      _id: data.mealId,
      isDeleted: false,
      publicationStatus: "published",
      isAvailable: true,
    });

    if (!meal) {
      throw new NotFoundException(
        "Meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (plan.vendorId && plan.vendorId.toString() !== meal.vendorId.toString()) {
      throw new BadRequestException(
        "A meal plan currently supports meals from one vendor at a time",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (!plan.vendorId) {
      plan.vendorId = meal.vendorId;
      await plan.save();
    }

    const today = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ),
    );

    const deliveryDates = generateDeliveryDates(
      plan.startDate,
      plan.endDate,
      plan.frequency,
      plan.customDays,
    ).filter((date) => date.getTime() >= today.getTime());

    const customization = data.customization ?? plan.defaultCustomization;

    const scheduledMeals = await ScheduledMeal.insertMany(
      deliveryDates.map((deliveryDate) => ({
        planId: plan._id,
        customerId: userId,
        vendorId: meal.vendorId,
        mealId: meal._id,
        mealName: meal.name,
        mealImageUrl: meal.primaryImageUrl,
        price: meal.price,
        deliveryDate,
        deliveryTimeWindow: plan.deliveryTimeWindow,
        customization,
        status: "scheduled",
      })),
    );

    const allScheduledMeals = await ScheduledMeal.find({
      planId: plan._id,
      status: { $ne: "cancelled" },
    }).select("price");

    return {
      plan: this.summarizePlan(plan, allScheduledMeals),
      scheduledMeals,
    };
  };

  getPlans = async (userId: string) => {
    const plans = await MealPlan.find({ customerId: userId }).sort({
      createdAt: -1,
    });

    const planIds = plans.map((plan) => plan._id);
    const scheduledMeals = await ScheduledMeal.find({
      planId: { $in: planIds },
      status: { $ne: "cancelled" },
    }).select("planId price");

    const scheduledMealsByPlan = new Map<string, { price: number }[]>();
    for (const scheduledMeal of scheduledMeals) {
      const key = scheduledMeal.planId.toString();
      const existing = scheduledMealsByPlan.get(key) ?? [];
      existing.push({ price: scheduledMeal.price });
      scheduledMealsByPlan.set(key, existing);
    }

    return {
      plans: plans.map((plan) =>
        this.summarizePlan(
          plan,
          scheduledMealsByPlan.get(plan._id.toString()) ?? [],
        ),
      ),
    };
  };

  getPlanDetails = async (userId: string, planId: string) => {
    const plan = await MealPlan.findOne({ _id: planId, customerId: userId });

    if (!plan) {
      throw new NotFoundException(
        "Meal plan not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const scheduledMeals = await ScheduledMeal.find({
      planId: plan._id,
    }).sort({ deliveryDate: 1 });

    const activeScheduledMeals = scheduledMeals.filter(
      (scheduledMeal) => scheduledMeal.status !== "cancelled",
    );

    return {
      plan: this.summarizePlan(plan, activeScheduledMeals),
      scheduledMeals,
    };
  };

  getUpcomingMeals = async (userId: string) => {
    const scheduledMeals = await ScheduledMeal.find({
      customerId: userId,
      status: "scheduled",
      deliveryDate: { $gte: new Date() },
    })
      .sort({ deliveryDate: 1 })
      .populate({ path: "planId", select: "name" });

    return { scheduledMeals };
  };

  getScheduledMeal = async (userId: string, scheduledMealId: string) => {
    const scheduledMeal = await ScheduledMeal.findOne({
      _id: scheduledMealId,
      customerId: userId,
    })
      .populate({ path: "planId", select: "name" })
      .populate({ path: "vendorId", select: "businessName" });

    if (!scheduledMeal) {
      throw new NotFoundException(
        "Scheduled meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { scheduledMeal };
  };

  updateScheduledMeal = async (
    userId: string,
    scheduledMealId: string,
    data: {
      deliveryDate?: Date;
      deliveryTimeWindow?: MealPlanTimeWindow;
      customization?: MealPlanCustomization;
    },
  ) => {
    const scheduledMeal = await ScheduledMeal.findOne({
      _id: scheduledMealId,
      customerId: userId,
    });

    if (!scheduledMeal) {
      throw new NotFoundException(
        "Scheduled meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (scheduledMeal.status !== "scheduled") {
      throw new BadRequestException(
        "Only scheduled meals can be edited",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    this.ensureEditableWindow(
      scheduledMeal.deliveryDate,
      scheduledMeal.deliveryTimeWindow,
    );

    if (data.deliveryDate !== undefined)
      scheduledMeal.deliveryDate = data.deliveryDate;
    if (data.deliveryTimeWindow !== undefined)
      scheduledMeal.deliveryTimeWindow = data.deliveryTimeWindow;
    if (data.customization !== undefined)
      scheduledMeal.customization = data.customization;

    await scheduledMeal.save();

    return { scheduledMeal };
  };

  cancelScheduledMeal = async (userId: string, scheduledMealId: string) => {
    const scheduledMeal = await ScheduledMeal.findOne({
      _id: scheduledMealId,
      customerId: userId,
    });

    if (!scheduledMeal) {
      throw new NotFoundException(
        "Scheduled meal not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (scheduledMeal.status !== "scheduled") {
      throw new BadRequestException(
        "Only scheduled meals can be cancelled",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    this.ensureEditableWindow(
      scheduledMeal.deliveryDate,
      scheduledMeal.deliveryTimeWindow,
    );

    scheduledMeal.status = "cancelled";
    scheduledMeal.cancelledAt = new Date();
    await scheduledMeal.save();

    return { scheduledMeal };
  };
}
