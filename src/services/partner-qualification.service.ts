/** @format */

import mongoose from "mongoose";

import Attribution from "../models/attribution.model.js";
import Meal from "../models/meal.model.js";
import Order from "../models/order.model.js";
import ReferralCampaign, {
  HomechefRules,
} from "../models/referralCampaign.model.js";
import Vendor from "../models/vendor.model.js";
import { AttributionService } from "./attribution.service.js";

const LEASE_MS = 2 * 60 * 1000;

type CampaignLean = {
  _id: mongoose.Types.ObjectId;
  rules?: { homechef?: HomechefRules };
  windowStartsAt?: Date;
  windowEndsAt?: Date;
};

// Successful-HomeChef qualification (agreed business rules), evaluated by the
// partner tracking job every few minutes:
//
//   base rule  = approved by admin
//                AND inspection completed (if rules.requireInspection)
//                AND >= 1 published + available meal (if rules.requireMenu)
//   early tier = the first `earlyTierSize` HomeChefs to meet the base rule
//                qualify on it alone, in the order they meet it
//   afterwards = base rule AND >= `completedOrdersAfterEarlyTier` delivered +
//                paid orders
//
// Only HomeChefs attributed before the campaign window ends are considered.
// Qualification is permanent (never revoked). Ranks are 1-based and gapless:
// one runner per campaign (lease) plus a unique (campaignId, rank) index.
// Reads Vendor / Meal / Order; never writes to them.
export class PartnerQualificationService {
  private attributionService = new AttributionService();

  evaluate = async (deadline: number = Date.now() + 30_000) => {
    const campaigns = await ReferralCampaign.find({ "rules.homechef": { $exists: true } })
      .select("_id rules windowStartsAt windowEndsAt")
      .lean<CampaignLean[]>();

    let qualified = 0;
    let skippedLocked = 0;

    for (const campaign of campaigns) {
      if (Date.now() >= deadline) break;

      await this.ensureWindow(campaign);

      const now = new Date();
      const leased = await ReferralCampaign.findOneAndUpdate(
        {
          _id: campaign._id,
          $or: [
            { qualificationLockUntil: { $exists: false } },
            { qualificationLockUntil: { $lt: now } },
          ],
        },
        { $set: { qualificationLockUntil: new Date(now.getTime() + LEASE_MS) } },
        { new: true },
      )
        .select("_id rules windowStartsAt windowEndsAt qualificationLockUntil")
        .lean<CampaignLean & { qualificationLockUntil: Date }>();

      if (!leased) {
        skippedLocked += 1;
        continue;
      }

      try {
        qualified += await this.processCampaign(leased, deadline);
      } finally {
        await ReferralCampaign.updateOne(
          { _id: leased._id, qualificationLockUntil: leased.qualificationLockUntil },
          { $unset: { qualificationLockUntil: 1 } },
        );
      }
    }

    return { qualified, qualificationCampaignsLocked: skippedLocked };
  };

  // Backstop for the window: if no approval signal opened it (e.g. the
  // HomeChef was approved before claiming), open it from the earliest known
  // approval among the campaign's HomeChefs.
  private ensureWindow = async (campaign: CampaignLean) => {
    if (campaign.windowStartsAt) return;
    const earliest = await Attribution.findOne({
      campaignId: campaign._id,
      subjectType: "vendor",
      firstApprovedAt: { $exists: true },
    })
      .sort({ firstApprovedAt: 1 })
      .select("firstApprovedAt")
      .lean<{ firstApprovedAt?: Date }>();
    if (earliest?.firstApprovedAt) {
      await this.attributionService.openHomechefWindowIfNeeded(
        campaign._id,
        earliest.firstApprovedAt,
      );
      const refreshed = await ReferralCampaign.findById(campaign._id)
        .select("windowStartsAt windowEndsAt")
        .lean<{ windowStartsAt?: Date; windowEndsAt?: Date }>();
      campaign.windowStartsAt = refreshed?.windowStartsAt;
      campaign.windowEndsAt = refreshed?.windowEndsAt;
    }
  };

  private processCampaign = async (campaign: CampaignLean, deadline: number) => {
    const rules = campaign.rules?.homechef;
    if (!rules) return 0;

    const filter: Record<string, unknown> = {
      campaignId: campaign._id,
      subjectType: "vendor",
      status: "active",
      qualifiedAt: { $exists: false },
      vendorId: { $exists: true },
    };
    if (campaign.windowEndsAt) filter.attributedAt = { $lt: campaign.windowEndsAt };

    const candidates = await Attribution.find(filter)
      .select("_id vendorId firstApprovedAt attributedAt")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          vendorId: mongoose.Types.ObjectId;
          firstApprovedAt?: Date;
          attributedAt: Date;
        }>
      >();
    if (!candidates.length) return 0;

    const vendorIds = candidates.map((c) => c.vendorId);

    const [vendors, menus, completedOrders] = await Promise.all([
      Vendor.find({ _id: { $in: vendorIds } })
        .select("approvalStatus inspectionStatus approvedAt")
        .lean<
          Array<{ _id: mongoose.Types.ObjectId; approvalStatus?: string; inspectionStatus?: string; approvedAt?: Date }>
        >(),
      Meal.aggregate<{ _id: mongoose.Types.ObjectId; mealId: mongoose.Types.ObjectId }>([
        {
          $match: {
            vendorId: { $in: vendorIds },
            publicationStatus: "published",
            isAvailable: true,
          },
        },
        { $group: { _id: "$vendorId", mealId: { $min: "$_id" } } },
      ]),
      Order.aggregate<{ _id: mongoose.Types.ObjectId; count: number; firstOrderId: mongoose.Types.ObjectId }>([
        {
          $match: {
            vendorId: { $in: vendorIds },
            status: "delivered",
            paymentStatus: "paid",
          },
        },
        { $group: { _id: "$vendorId", count: { $sum: 1 }, firstOrderId: { $min: "$_id" } } },
      ]),
    ]);

    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));
    const menuByVendor = new Map(menus.map((m) => [String(m._id), String(m.mealId)]));
    const ordersByVendor = new Map(completedOrders.map((o) => [String(o._id), o]));

    // Readiness order: earliest approval first (then earliest registration),
    // so "the first N to meet the rule" is honoured within a run.
    const readiness = (c: (typeof candidates)[number]) =>
      (c.firstApprovedAt ?? vendorById.get(String(c.vendorId))?.approvedAt ?? c.attributedAt).getTime();
    candidates.sort((a, b) => readiness(a) - readiness(b) || a.attributedAt.getTime() - b.attributedAt.getTime());

    let qualified = 0;
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;
      const key = String(candidate.vendorId);
      const vendor = vendorById.get(key);
      if (!vendor || vendor.approvalStatus !== "approved") continue;
      if (rules.requireInspection && vendor.inspectionStatus !== "completed") continue;
      const menuMealId = menuByVendor.get(key);
      if (rules.requireMenu && !menuMealId) continue;
      const orders = ordersByVendor.get(key);

      // Early tier: take a slot only while slots remain.
      let tier: "early" | "standard" = "early";
      let counter = await ReferralCampaign.findOneAndUpdate(
        { _id: campaign._id, qualifiedCount: { $lt: rules.earlyTierSize } },
        { $inc: { qualifiedCount: 1 } },
        { new: true },
      )
        .select("qualifiedCount")
        .lean<{ qualifiedCount: number }>();

      if (!counter) {
        if ((orders?.count ?? 0) < rules.completedOrdersAfterEarlyTier) continue;
        tier = "standard";
        counter = await ReferralCampaign.findOneAndUpdate(
          { _id: campaign._id },
          { $inc: { qualifiedCount: 1 } },
          { new: true },
        )
          .select("qualifiedCount")
          .lean<{ qualifiedCount: number }>();
      }
      if (!counter) continue;

      const now = new Date();
      const rank = counter.qualifiedCount;
      try {
        const stamped = await Attribution.updateOne(
          { _id: candidate._id, qualifiedAt: { $exists: false } },
          {
            $set: {
              qualifiedAt: now,
              qualificationRank: rank,
              qualificationTier: tier,
              qualificationEvidence: {
                approvedAt: candidate.firstApprovedAt ?? vendor.approvedAt,
                inspectionStatus: vendor.inspectionStatus,
                menuMealId,
                firstCompletedOrderId: orders?.firstOrderId ? String(orders.firstOrderId) : undefined,
              },
            },
            $push: {
              events: { type: "homechef.qualified", at: now, actorType: "system", data: { rank, tier } },
            },
          },
        );
        if (stamped.modifiedCount === 1) {
          qualified += 1;
          continue;
        }
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) throw error;
      }
      // Not stamped (already qualified / rank taken): give the rank back so
      // ranks stay gapless. Safe under the lease (no concurrent increments).
      await ReferralCampaign.updateOne(
        { _id: campaign._id, qualifiedCount: rank },
        { $inc: { qualifiedCount: -1 } },
      );
    }
    return qualified;
  };
}

export const partnerQualificationService = new PartnerQualificationService();
