/** @format */

import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Attribution from "../models/attribution.model.js";
import Order from "../models/order.model.js";
import Partner from "../models/partner.model.js";
import PartnerSettlement, {
  PartnerSettlementDocument,
} from "../models/partnerSettlement.model.js";
import PartnerSubmission from "../models/partnerSubmission.model.js";
import Payment from "../models/payment.model.js";
import ReferralCampaign, {
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";

import { paginate, Pagination, paginationResult } from "../util/pagination.util.js";
import {
  DAY_MS,
  formatWatDate,
  roundMoney,
  watWeekStart,
  WEEK_MS,
} from "../util/referral.util.js";

type ObjectId = mongoose.Types.ObjectId;

// Read-only data for the admin "Partnerships" screens (list, Overview,
// HomeChefs, Customers, Earnings). Every figure is computed from the source
// records (Attribution, Vendor, Order, Payment, PartnerSettlement) using the
// agreed commercial rules on the campaign — nothing is stored or hard-coded.
//
// Money definitions used throughout:
//  - Purchase value      = Order.totalAmount of qualifying orders (what the
//                          customer paid).
//  - TOW earned (order)  = 20% platform fee + service charge − Paystack fee.
//  - Commission          = rules.customer.revenueSharePercent of TOW earned
//                          (NOT of purchase value). Platform cost is deducted
//                          later, in the weekly statement.
//  - HomeChef incentive  = rules.homechef.payoutPerHomechef per SUCCESSFUL
//                          HomeChef within the payable cap.
// Qualifying order: paymentStatus "paid", status not "cancelled", paidAt
// inside the customer's attribution window [attributedAt, expiresAt).

const FAR_FUTURE = new Date(8_640_000_000_000_000);

const badRequest = (message: string) =>
  new BadRequestException(message, HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
const notFound = (what: string) =>
  new NotFoundException(`${what} not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type DateRange = { from?: Date; to?: Date };

const rangeFilter = (field: string, range: DateRange) => {
  if (!range.from && !range.to) return {};
  return {
    [field]: {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.to ? { $lt: range.to } : {}),
    },
  };
};

const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null; // null = "new" (no baseline)
  return roundMoney(((current - previous) / previous) * 100);
};

// Order + payments → TOW earned, as an aggregation stage list (used inside
// $lookup pipelines so lists can be filtered, counted and paginated in Mongo).
const orderEarningsStages = [
  {
    $lookup: {
      from: Payment.collection.name,
      let: { oid: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$orderId", "$$oid"] },
            status: "succeeded",
            context: "order",
          },
        },
        { $project: { vendorPlatformFeeAmount: 1, paystackFeeAmount: 1 } },
      ],
      as: "payments",
    },
  },
  {
    $project: {
      paidAt: 1,
      totalAmount: 1,
      towEarned: {
        $subtract: [
          {
            $add: [
              { $sum: "$payments.vendorPlatformFeeAmount" },
              { $ifNull: ["$serviceCharge", 0] },
            ],
          },
          { $sum: "$payments.paystackFeeAmount" },
        ],
      },
    },
  },
];

// $lookup of an attribution's qualifying orders (optionally within a paidAt range).
const qualifyingOrdersLookup = (range: DateRange = {}) => ({
  $lookup: {
    from: Order.collection.name,
    let: {
      uid: "$subjectUserId",
      start: "$attributedAt",
      end: { $ifNull: ["$expiresAt", FAR_FUTURE] },
    },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$customerId", "$$uid"] },
              { $gte: ["$paidAt", "$$start"] },
              { $lt: ["$paidAt", "$$end"] },
              ...(range.from ? [{ $gte: ["$paidAt", range.from] }] : []),
              ...(range.to ? [{ $lt: ["$paidAt", range.to] }] : []),
            ],
          },
          paymentStatus: "paid",
          status: { $ne: "cancelled" },
        },
      },
      ...orderEarningsStages,
    ],
    as: "orders",
  },
});

const userLookup = {
  $lookup: {
    from: User.collection.name,
    let: { uid: "$subjectUserId" },
    pipeline: [
      { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
      { $project: { firstName: 1, lastName: 1, email: 1 } },
    ],
    as: "user",
  },
};

const searchStage = (search?: string, extraFields: string[] = []) => {
  if (!search) return [];
  const regex = escapeRegex(search);
  return [
    {
      $match: {
        $expr: {
          $or: [
            {
              $regexMatch: {
                input: {
                  $concat: [
                    { $ifNull: ["$user.firstName", ""] },
                    " ",
                    { $ifNull: ["$user.lastName", ""] },
                  ],
                },
                regex,
                options: "i",
              },
            },
            { $regexMatch: { input: { $ifNull: ["$user.email", ""] }, regex, options: "i" } },
            ...extraFields.map((field) => ({
              $regexMatch: { input: { $ifNull: [`$${field}`, ""] }, regex, options: "i" },
            })),
          ],
        },
      },
    },
  ];
};

const fullName = (user?: { firstName?: string; lastName?: string } | null) =>
  user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null : null;

export class PartnershipDashboardService {
  // ── Shared ────────────────────────────────────────────────────────────

  private getCampaign = async (campaignId: string) => {
    if (!mongoose.isValidObjectId(campaignId)) throw badRequest("Invalid campaign id");
    const campaign = await ReferralCampaign.findById(campaignId).lean<ReferralCampaignDocument & { _id: ObjectId }>();
    if (!campaign) throw notFound("Campaign");
    const partner = campaign.partnerId
      ? await Partner.findById(campaign.partnerId).select("name slug status").lean<{ _id: ObjectId; name: string; slug: string; status: string }>()
      : null;
    return { campaign, partner };
  };

  private header = (
    campaign: ReferralCampaignDocument & { _id: ObjectId },
    partner: { _id: ObjectId; name: string; slug: string; status: string } | null,
  ) => {
    const now = Date.now();
    const end = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;
    const start = new Date(campaign.startsAt).getTime();
    const windowEnd = campaign.windowEndsAt ? new Date(campaign.windowEndsAt).getTime() : null;
    return {
      campaignId: String(campaign._id),
      campaignName: campaign.name,
      partner: partner ? { id: String(partner._id), name: partner.name, slug: partner.slug, status: partner.status } : null,
      title: partner?.name ?? campaign.name,
      subtitle: partner ? `TOW × ${partner.name}` : campaign.name,
      status: campaign.status,
      period: {
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt ?? null,
        totalDays: end ? Math.round((end - start) / DAY_MS) : null,
        daysRemaining: end ? Math.max(0, Math.ceil((end - now) / DAY_MS)) : null,
      },
      homechefWindow: campaign.rules?.homechef
        ? {
            windowDays: campaign.rules.homechef.windowDays,
            startsAt: campaign.windowStartsAt ?? null,
            endsAt: campaign.windowEndsAt ?? null,
            daysRemaining: windowEnd ? Math.max(0, Math.ceil((windowEnd - now) / DAY_MS)) : null,
            note: campaign.windowStartsAt
              ? null
              : "Opens automatically when the first HomeChef from this campaign is approved",
          }
        : null,
      rules: campaign.rules ?? null,
    };
  };

  private sharePercent = (campaign: ReferralCampaignDocument) =>
    campaign.rules?.customer?.revenueSharePercent ?? 0;

  // Campaign-wide customer totals (optionally restricted to a paidAt range).
  private customerTotals = async (campaign: ReferralCampaignDocument & { _id: ObjectId }, paidRange: DateRange = {}) => {
    const [agg] = await Attribution.aggregate<{
      referred: number;
      withPurchases: number;
      purchases: number;
      purchaseValue: number;
      towEarned: number;
    }>([
      { $match: { campaignId: campaign._id, subjectType: "customer", status: "active" } },
      qualifyingOrdersLookup(paidRange),
      {
        $group: {
          _id: null,
          referred: { $sum: 1 },
          withPurchases: { $sum: { $cond: [{ $gt: [{ $size: "$orders" }, 0] }, 1, 0] } },
          purchases: { $sum: { $size: "$orders" } },
          purchaseValue: { $sum: { $sum: "$orders.totalAmount" } },
          towEarned: { $sum: { $sum: "$orders.towEarned" } },
        },
      },
    ]);
    const pct = this.sharePercent(campaign);
    const totals = agg ?? { referred: 0, withPurchases: 0, purchases: 0, purchaseValue: 0, towEarned: 0 };
    return {
      ...totals,
      purchaseValue: roundMoney(totals.purchaseValue),
      towEarned: roundMoney(totals.towEarned),
      sharePercent: pct,
      commission: roundMoney((totals.towEarned * pct) / 100),
    };
  };

  private homechefIncentives = async (campaign: ReferralCampaignDocument & { _id: ObjectId }, qualifiedRange: DateRange = {}) => {
    const rules = campaign.rules?.homechef;
    if (!rules) return { successful: 0, payable: 0, perHomechef: 0, amount: 0 };
    const [successful, payable] = await Promise.all([
      Attribution.countDocuments({
        campaignId: campaign._id,
        qualificationRank: { $exists: true },
        ...rangeFilter("qualifiedAt", qualifiedRange),
      }),
      Attribution.countDocuments({
        campaignId: campaign._id,
        qualificationRank: { $gte: 1, $lte: rules.payableCap },
        ...rangeFilter("qualifiedAt", qualifiedRange),
      }),
    ]);
    return {
      successful,
      payable,
      perHomechef: rules.payoutPerHomechef,
      amount: roundMoney(payable * rules.payoutPerHomechef),
    };
  };

  // ── Partnerships list ─────────────────────────────────────────────────

  listPartnerships = async (filters: Pagination & { status?: string }) => {
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = { programType: "partner" };
    if (filters.status) query.status = filters.status;
    const [campaigns, total] = await Promise.all([
      ReferralCampaign.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<Array<ReferralCampaignDocument & { _id: ObjectId }>>(),
      ReferralCampaign.countDocuments(query),
    ]);
    const partners = await Partner.find({ _id: { $in: campaigns.map((c) => c.partnerId).filter(Boolean) } })
      .select("name slug status")
      .lean<Array<{ _id: ObjectId; name: string; slug: string; status: string }>>();
    const partnerById = new Map(partners.map((p) => [String(p._id), p]));

    const thisWeek = watWeekStart(new Date());
    const lastWeek = new Date(thisWeek.getTime() - WEEK_MS);
    const items = await Promise.all(
      campaigns.map(async (campaign) => {
        const partner = campaign.partnerId ? partnerById.get(String(campaign.partnerId)) ?? null : null;
        const [referrals, referralsThisWeek, referralsLastWeek, earningsAll, earningsThis, earningsLast] = await Promise.all([
          Attribution.countDocuments({ campaignId: campaign._id }),
          Attribution.countDocuments({ campaignId: campaign._id, attributedAt: { $gte: thisWeek } }),
          Attribution.countDocuments({ campaignId: campaign._id, attributedAt: { $gte: lastWeek, $lt: thisWeek } }),
          this.grossEarnings(campaign, {}),
          this.grossEarnings(campaign, { from: thisWeek }),
          this.grossEarnings(campaign, { from: lastWeek, to: thisWeek }),
        ]);
        return {
          ...this.header(campaign, partner),
          totalReferrals: referrals,
          referralsChangePercent: percentChange(referralsThisWeek, referralsLastWeek),
          totalEarnings: earningsAll,
          earningsChangePercent: percentChange(earningsThis, earningsLast),
        };
      }),
    );
    return { items, pagination: paginationResult(page, limit, total) };
  };

  // Gross partner earnings (HomeChef incentives + customer commission) in a range.
  private grossEarnings = async (campaign: ReferralCampaignDocument & { _id: ObjectId }, range: DateRange) => {
    const [incentives, customers] = await Promise.all([
      this.homechefIncentives(campaign, range),
      this.customerTotals(campaign, range),
    ]);
    return roundMoney(incentives.amount + customers.commission);
  };

  // ── Overview tab ──────────────────────────────────────────────────────

  getOverview = async (campaignId: string, activity: Pagination) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    const rules = campaign.rules?.homechef;
    const [incentives, customers, weekly, recent] = await Promise.all([
      this.homechefIncentives(campaign),
      this.customerTotals(campaign),
      this.weeklyReferrals(campaign),
      this.recentActivity(campaign, activity),
    ]);
    const target = rules?.payableCap ?? campaign.targets?.homechefs ?? null;
    return {
      header: this.header(campaign, partner),
      cards: {
        successfulHomechefs: {
          count: incentives.payable,
          target,
          percentOfTarget: target ? roundMoney((incentives.payable / target) * 100) : null,
        },
        referredCustomers: customers.referred,
        customerPurchaseValue: customers.purchaseValue,
        partnerEarnings: roundMoney(incentives.amount + customers.commission),
      },
      referralActivity: weekly,
      recentActivity: recent,
    };
  };

  // Registered referrals per WAT week since the campaign started.
  private weeklyReferrals = async (campaign: ReferralCampaignDocument & { _id: ObjectId }) => {
    const first = watWeekStart(new Date(campaign.startsAt)).getTime();
    const lastAt = campaign.endsAt && new Date(campaign.endsAt).getTime() < Date.now() ? new Date(campaign.endsAt) : new Date();
    const last = watWeekStart(lastAt).getTime();
    const weeks = last >= first ? Math.floor((last - first) / WEEK_MS) + 1 : 0;
    const rows = await Attribution.aggregate<{ _id: { week: number; type: string }; count: number }>([
      { $match: { campaignId: campaign._id, attributedAt: { $gte: new Date(first) } } },
      {
        $group: {
          _id: {
            week: { $floor: { $divide: [{ $subtract: ["$attributedAt", new Date(first)] }, WEEK_MS] } },
            type: "$subjectType",
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const counts = new Map(rows.map((r) => [`${r._id.week}:${r._id.type}`, r.count]));
    return Array.from({ length: weeks }, (_, i) => ({
      label: `Week ${i + 1}`,
      weekStart: formatWatDate(new Date(first + i * WEEK_MS)),
      homechefReferrals: counts.get(`${i}:vendor`) ?? 0,
      customerReferrals: counts.get(`${i}:customer`) ?? 0,
    }));
  };

  private recentActivity = async (campaign: ReferralCampaignDocument & { _id: ObjectId }, pagination: Pagination) => {
    const { page, limit } = paginate(pagination);
    const take = page * limit;
    const base = { campaignId: campaign._id };

    const [referred, approved, successful, purchases, settlements, counts] = await Promise.all([
      Attribution.find(base).sort({ attributedAt: -1 }).limit(take).select("subjectUserId subjectType attributedAt").lean(),
      Attribution.find({ ...base, subjectType: "vendor", firstApprovedAt: { $exists: true } })
        .sort({ firstApprovedAt: -1 }).limit(take).select("subjectUserId firstApprovedAt").lean(),
      Attribution.find({ ...base, qualifiedAt: { $exists: true } })
        .sort({ qualifiedAt: -1 }).limit(take).select("subjectUserId qualifiedAt qualificationRank").lean(),
      Attribution.aggregate<{ subjectUserId: ObjectId; order: { _id: ObjectId; paidAt: Date; totalAmount: number; towEarned: number } }>([
        { $match: { ...base, subjectType: "customer", status: "active" } },
        qualifyingOrdersLookup(),
        { $unwind: "$orders" },
        { $sort: { "orders.paidAt": -1 } },
        { $limit: take },
        { $project: { subjectUserId: 1, order: "$orders" } },
      ]),
      PartnerSettlement.find(base).sort({ finalizedAt: -1 }).limit(take).select("-lines").lean<PartnerSettlementDocument[]>(),
      this.activityCounts(campaign),
    ]);

    const userIds = [...referred, ...approved, ...successful].map((a: any) => a.subjectUserId).concat(purchases.map((p) => p.subjectUserId));
    const users = await User.find({ _id: { $in: userIds } }).select("firstName lastName").lean<Array<{ _id: ObjectId; firstName?: string; lastName?: string }>>();
    const nameOf = new Map(users.map((u) => [String(u._id), fullName(u)]));
    const pct = this.sharePercent(campaign);

    const events: Array<{ type: string; activity: string; details: string; date: Date; status: string }> = [
      ...referred.map((a: any) => ({
        type: a.subjectType === "vendor" ? "homechef_referred" : "customer_referred",
        activity: a.subjectType === "vendor" ? "HomeChef referred" : "Customer referred",
        details: nameOf.get(String(a.subjectUserId)) ?? "Unknown",
        date: a.attributedAt,
        status: "registered",
      })),
      ...approved.map((a: any) => ({
        type: "homechef_approved",
        activity: "HomeChef approved",
        details: nameOf.get(String(a.subjectUserId)) ?? "Unknown",
        date: a.firstApprovedAt,
        status: "approved",
      })),
      ...successful.map((a: any) => ({
        type: "homechef_successful",
        activity: "HomeChef became successful",
        details: `${nameOf.get(String(a.subjectUserId)) ?? "Unknown"} · #${a.qualificationRank}`,
        date: a.qualifiedAt,
        status: "earned",
      })),
      ...purchases.map((p) => ({
        type: "customer_purchase",
        activity: "Customer purchase",
        details: `${nameOf.get(String(p.subjectUserId)) ?? "Unknown"} · ₦${roundMoney(p.order.totalAmount).toLocaleString("en-NG")} (commission ₦${roundMoney((p.order.towEarned * pct) / 100).toLocaleString("en-NG")})`,
        date: p.order.paidAt,
        status: "recorded",
      })),
      ...settlements.flatMap((s) => [
        {
          type: "payout_recorded",
          activity: s.type === "homechef_batch" ? `HomeChef batch ${s.batchNumber} finalized` : `Week of ${formatWatDate(s.periodStart as Date)} finalized`,
          details: `₦${(s.totals?.payout ?? 0).toLocaleString("en-NG")}`,
          date: s.finalizedAt,
          status: "pending",
        },
        ...(s.paidAt
          ? [{
              type: "payout_paid",
              activity: "Payout paid",
              details: `₦${(s.totals?.payout ?? 0).toLocaleString("en-NG")} · ${s.paymentReference ?? ""}`.trim(),
              date: s.paidAt,
              status: "paid",
            }]
          : []),
      ]),
    ]
      .filter((e) => e.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      items: events.slice((page - 1) * limit, page * limit),
      pagination: paginationResult(page, limit, counts),
    };
  };

  private activityCounts = async (campaign: ReferralCampaignDocument & { _id: ObjectId }) => {
    const base = { campaignId: campaign._id };
    const [referred, approved, successful, settlements, paid, purchases] = await Promise.all([
      Attribution.countDocuments(base),
      Attribution.countDocuments({ ...base, subjectType: "vendor", firstApprovedAt: { $exists: true } }),
      Attribution.countDocuments({ ...base, qualifiedAt: { $exists: true } }),
      PartnerSettlement.countDocuments(base),
      PartnerSettlement.countDocuments({ ...base, paidAt: { $exists: true } }),
      this.customerTotals(campaign).then((t) => t.purchases),
    ]);
    return referred + approved + successful + settlements + paid + purchases;
  };

  // ── HomeChefs tab ─────────────────────────────────────────────────────

  private homechefPipeline = (
    campaign: ReferralCampaignDocument & { _id: ObjectId },
    range: DateRange,
    search?: string,
    attributionId?: ObjectId,
  ) => [
    {
      $match: {
        ...(attributionId ? { _id: attributionId } : {}),
        campaignId: campaign._id,
        subjectType: "vendor",
        status: "active",
        ...rangeFilter("attributedAt", range),
      },
    },
    userLookup,
    {
      $lookup: {
        from: Vendor.collection.name,
        let: { vid: "$vendorId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$vid"] } } },
          {
            $project: {
              businessName: 1,
              approvalStatus: 1,
              inspectionStatus: 1,
              approvedAt: 1,
              rejectionReason: 1,
              "additionalData.onboarding.submittedAt": 1,
            },
          },
        ],
        as: "vendor",
      },
    },
    { $addFields: { user: { $arrayElemAt: ["$user", 0] }, vendor: { $arrayElemAt: ["$vendor", 0] } } },
    {
      $addFields: {
        lifecycle: {
          $switch: {
            branches: [
              { case: { $eq: [{ $ifNull: ["$vendor", null] }, null] }, then: "closed" },
              { case: { $eq: ["$vendor.approvalStatus", "approved"] }, then: "approved" },
              { case: { $eq: ["$vendor.approvalStatus", "rejected"] }, then: "rejected" },
              { case: { $eq: ["$vendor.approvalStatus", "suspended"] }, then: "suspended" },
            ],
            default: "pending",
          },
        },
      },
    },
    ...searchStage(search, ["vendor.businessName", "externalRef"]),
  ];

  private incentiveFor = (
    campaign: ReferralCampaignDocument,
    rank: number | undefined,
    settlementByBatch: Map<number, PartnerSettlementDocument>,
  ) => {
    const rules = campaign.rules?.homechef;
    if (!rules || !rank) return { eligibleAmount: 0, payoutStatus: "not_eligible", batchNumber: null };
    if (rank > rules.payableCap) return { eligibleAmount: 0, payoutStatus: "over_cap", batchNumber: null };
    const batchNumber = Math.ceil(rank / rules.settlementBatchSize);
    const settlement = settlementByBatch.get(batchNumber);
    return {
      eligibleAmount: rules.payoutPerHomechef,
      payoutStatus: settlement ? (settlement.status === "paid" ? "paid" : "pending") : "earned",
      batchNumber,
    };
  };

  private batchSettlements = async (campaign: ReferralCampaignDocument & { _id: ObjectId }) => {
    const rows = await PartnerSettlement.find({ campaignId: campaign._id, type: "homechef_batch" })
      .select("-lines")
      .lean<PartnerSettlementDocument[]>();
    return new Map(rows.map((r) => [r.batchNumber as number, r]));
  };

  listHomechefs = async (
    campaignId: string,
    filters: Pagination & DateRange & { status?: "all" | "pending" | "approved" | "rejected" | "suspended" | "successful"; search?: string },
  ) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    const { page, limit, skip } = paginate(filters);
    const tab = filters.status && filters.status !== "all" ? filters.status : null;
    const tabMatch = tab === "successful" ? { qualifiedAt: { $exists: true } } : tab ? { lifecycle: tab } : {};

    const [result] = await Attribution.aggregate<{
      counts: Array<{ _id: string; n: number }>;
      successful: Array<{ n: number }>;
      total: Array<{ n: number }>;
      page: any[];
    }>([
      ...this.homechefPipeline(campaign, { from: filters.from, to: filters.to }, filters.search),
      {
        $facet: {
          counts: [{ $group: { _id: "$lifecycle", n: { $sum: 1 } } }],
          successful: [{ $match: { qualifiedAt: { $exists: true } } }, { $count: "n" }],
          total: [{ $match: tabMatch }, { $count: "n" }],
          page: [{ $match: tabMatch }, { $sort: { attributedAt: -1, _id: -1 } }, { $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const counts = Object.fromEntries((result?.counts ?? []).map((c) => [c._id, c.n]));
    const all = Object.values(counts).reduce((s: number, n) => s + (n as number), 0);
    const settlementByBatch = await this.batchSettlements(campaign);

    const [summary, incentives] = await Promise.all([this.homechefSummary(campaign), this.homechefIncentives(campaign)]);

    return {
      header: this.header(campaign, partner),
      cards: summary,
      progress: {
        successful: incentives.payable,
        target: campaign.rules?.homechef?.payableCap ?? campaign.targets?.homechefs ?? null,
        percent: campaign.rules?.homechef?.payableCap
          ? roundMoney((incentives.payable / campaign.rules.homechef.payableCap) * 100)
          : null,
      },
      tabs: {
        all,
        pending: counts.pending ?? 0,
        approved: counts.approved ?? 0,
        rejected: counts.rejected ?? 0,
        suspended: counts.suspended ?? 0,
        successful: result?.successful?.[0]?.n ?? 0,
      },
      items: (result?.page ?? []).map((row) => ({
        attributionId: String(row._id),
        name: fullName(row.user),
        email: row.user?.email ?? null,
        businessName: row.vendor?.businessName ?? null,
        dateReferred: row.attributedAt,
        status: row.lifecycle,
        onboardingSubmitted: !!row.vendor?.additionalData?.onboarding?.submittedAt,
        inspectionStatus: row.vendor?.inspectionStatus ?? null,
        approvalDate: row.firstApprovedAt ?? row.vendor?.approvedAt ?? null,
        successful: !!row.qualifiedAt,
        successfulAt: row.qualifiedAt ?? null,
        rank: row.qualificationRank ?? null,
        incentive: this.incentiveFor(campaign, row.qualificationRank, settlementByBatch),
      })),
      pagination: paginationResult(page, limit, result?.total?.[0]?.n ?? 0),
    };
  };

  // Cards for the HomeChefs tab (campaign-wide; not affected by filters).
  private homechefSummary = async (campaign: ReferralCampaignDocument & { _id: ObjectId }) => {
    const [submissions, direct, lifecycle] = await Promise.all([
      PartnerSubmission.countDocuments({ campaignId: campaign._id, type: "homechef" }),
      Attribution.countDocuments({ campaignId: campaign._id, subjectType: "vendor", partnerSubmissionId: { $exists: false } }),
      Attribution.aggregate<{ _id: string; n: number }>([
        ...this.homechefPipeline(campaign, {}),
        { $group: { _id: "$lifecycle", n: { $sum: 1 } } },
      ]),
    ]);
    const byStatus = Object.fromEntries(lifecycle.map((l) => [l._id, l.n]));
    return {
      totalReferred: submissions + direct,
      registered: Object.values(byStatus).reduce((s: number, n) => s + (n as number), 0),
      approved: byStatus.approved ?? 0,
      pending: byStatus.pending ?? 0,
      rejected: byStatus.rejected ?? 0,
      suspended: byStatus.suspended ?? 0,
    };
  };

  getHomechef = async (campaignId: string, attributionId: string) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    if (!mongoose.isValidObjectId(attributionId)) throw badRequest("Invalid HomeChef id");
    const [row] = await Attribution.aggregate(
      this.homechefPipeline(campaign, {}, undefined, new mongoose.Types.ObjectId(attributionId)),
    );
    if (!row) throw notFound("HomeChef");
    const rules = campaign.rules?.homechef;
    const incentive = this.incentiveFor(campaign, row.qualificationRank, await this.batchSettlements(campaign));
    return {
      attributionId: String(row._id),
      name: fullName(row.user),
      email: row.user?.email ?? null,
      businessName: row.vendor?.businessName ?? null,
      referral: {
        referredBy: partner?.name ?? campaign.name,
        source:
          row.channel === "partner_invite"
            ? `${partner?.name ?? "Partner"} invite${row.externalRef ? ` (their ID ${row.externalRef})` : ""}`
            : `${partner?.name ?? "Campaign"} HomeChef code ${row.codeSnapshot}`,
        channel: row.channel,
        code: row.codeSnapshot,
        externalRef: row.externalRef ?? null,
        dateReferred: row.attributedAt,
      },
      onboarding: {
        status: row.lifecycle,
        onboardingSubmittedAt: row.vendor?.additionalData?.onboarding?.submittedAt ?? null,
        inspectionStatus: row.vendor?.inspectionStatus ?? null,
        approvalDate: row.firstApprovedAt ?? row.vendor?.approvedAt ?? null,
      },
      success: {
        successful: !!row.qualifiedAt,
        successfulAt: row.qualifiedAt ?? null,
        rank: row.qualificationRank ?? null,
        tier: row.qualificationTier ?? null,
        evidence: row.qualificationEvidence ?? null,
      },
      incentive,
      ruleText: rules
        ? `A HomeChef is successful once approved, inspected and has a published menu. The first ${rules.earlyTierSize} qualify on that alone; after that they also need ${rules.completedOrdersAfterEarlyTier} completed order${rules.completedOrdersAfterEarlyTier === 1 ? "" : "s"}. Each successful HomeChef earns ₦${rules.payoutPerHomechef.toLocaleString("en-NG")}, up to ${rules.payableCap.toLocaleString("en-NG")} HomeChefs, paid in batches of ${rules.settlementBatchSize}.`
        : null,
    };
  };

  // ── Customers tab ─────────────────────────────────────────────────────

  listCustomers = async (
    campaignId: string,
    filters: Pagination & DateRange & { purchase?: "all" | "purchased" | "none"; search?: string },
  ) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    const { page, limit, skip } = paginate(filters);
    const pct = this.sharePercent(campaign);
    const tabMatch =
      filters.purchase === "purchased"
        ? { purchases: { $gt: 0 } }
        : filters.purchase === "none"
          ? { purchases: 0 }
          : {};

    const [result] = await Attribution.aggregate<{
      counts: Array<{ all: number; purchased: number }>;
      total: Array<{ n: number }>;
      page: any[];
    }>([
      {
        $match: {
          campaignId: campaign._id,
          subjectType: "customer",
          status: "active",
          ...rangeFilter("attributedAt", { from: filters.from, to: filters.to }),
        },
      },
      userLookup,
      { $addFields: { user: { $arrayElemAt: ["$user", 0] } } },
      ...searchStage(filters.search, ["externalRef"]),
      qualifyingOrdersLookup(),
      {
        $addFields: {
          purchases: { $size: "$orders" },
          purchaseValue: { $sum: "$orders.totalAmount" },
          towEarned: { $sum: "$orders.towEarned" },
        },
      },
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                all: { $sum: 1 },
                purchased: { $sum: { $cond: [{ $gt: ["$purchases", 0] }, 1, 0] } },
              },
            },
          ],
          total: [{ $match: tabMatch }, { $count: "n" }],
          page: [
            { $match: tabMatch },
            { $sort: { attributedAt: -1, _id: -1 } },
            { $skip: skip },
            { $limit: limit },
            { $project: { orders: 0, events: 0 } },
          ],
        },
      },
    ]);

    const counts = result?.counts?.[0] ?? { all: 0, purchased: 0 };
    const summary = await this.customerTotals(campaign);
    return {
      header: this.header(campaign, partner),
      cards: {
        totalReferred: summary.referred,
        withPurchases: summary.withPurchases,
        purchaseValue: summary.purchaseValue,
        commission: summary.commission,
      },
      commissionRule: {
        sharePercent: pct,
        text: `Commission: ${pct}% of TOW's earnings on qualifying purchases (the 20% platform fee plus service charge, less the Paystack fee). Platform cost is deducted in the weekly statement.`,
      },
      tabs: { all: counts.all, purchased: counts.purchased, noPurchase: counts.all - counts.purchased },
      items: (result?.page ?? []).map((row) => ({
        attributionId: String(row._id),
        name: fullName(row.user),
        email: row.user?.email ?? null,
        dateReferred: row.attributedAt,
        purchases: row.purchases,
        purchaseValue: roundMoney(row.purchaseValue),
        towEarned: roundMoney(row.towEarned),
        commission: roundMoney((row.towEarned * pct) / 100),
        commissionPeriodEndsAt: row.expiresAt ?? null,
      })),
      pagination: paginationResult(page, limit, result?.total?.[0]?.n ?? 0),
    };
  };

  getCustomer = async (campaignId: string, attributionId: string, pagination: Pagination) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    if (!mongoose.isValidObjectId(attributionId)) throw badRequest("Invalid customer id");
    const attribution = await Attribution.findOne({
      _id: attributionId,
      campaignId: campaign._id,
      subjectType: "customer",
    }).lean<any>();
    if (!attribution) throw notFound("Customer");
    const user = await User.findById(attribution.subjectUserId).select("firstName lastName email").lean<any>();
    const pct = this.sharePercent(campaign);
    const { page, limit, skip } = paginate(pagination);

    const orderMatch = {
      customerId: attribution.subjectUserId,
      paymentStatus: "paid",
      status: { $ne: "cancelled" },
      paidAt: { $gte: attribution.attributedAt, $lt: attribution.expiresAt ?? FAR_FUTURE },
    };
    const [rows, totals] = await Promise.all([
      Order.aggregate([
        { $match: orderMatch },
        { $sort: { paidAt: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        ...orderEarningsStages,
      ]),
      Order.aggregate([
        { $match: orderMatch },
        ...orderEarningsStages,
        { $group: { _id: null, count: { $sum: 1 }, purchaseValue: { $sum: "$totalAmount" }, towEarned: { $sum: "$towEarned" } } },
      ]),
    ]);
    const t = totals[0] ?? { count: 0, purchaseValue: 0, towEarned: 0 };
    return {
      attributionId: String(attribution._id),
      name: fullName(user),
      email: user?.email ?? null,
      referral: {
        referredBy: partner?.name ?? campaign.name,
        source:
          attribution.channel === "partner_invite"
            ? `${partner?.name ?? "Partner"} invite${attribution.externalRef ? ` (their ID ${attribution.externalRef})` : ""}`
            : `${partner?.name ?? "Campaign"} customer code ${attribution.codeSnapshot}`,
        channel: attribution.channel,
        code: attribution.codeSnapshot,
        externalRef: attribution.externalRef ?? null,
        dateReferred: attribution.attributedAt,
      },
      totals: {
        purchases: t.count,
        purchaseValue: roundMoney(t.purchaseValue),
        towEarned: roundMoney(t.towEarned),
        commission: roundMoney((t.towEarned * pct) / 100),
      },
      commissionPeriodEndsAt: attribution.expiresAt ?? null,
      note: `This customer is attributed to ${partner?.name ?? campaign.name} until ${attribution.expiresAt ? formatWatDate(new Date(attribution.expiresAt)) : "further notice"}. Only paid, non-refunded orders inside that period count.`,
      purchaseHistory: {
        items: rows.map((o: any) => ({
          orderId: String(o._id),
          date: o.paidAt,
          amount: roundMoney(o.totalAmount),
          towEarned: roundMoney(o.towEarned),
          commission: roundMoney((o.towEarned * pct) / 100),
        })),
        pagination: paginationResult(page, limit, t.count),
      },
    };
  };

  // ── Earnings tab ──────────────────────────────────────────────────────

  getEarnings = async (campaignId: string) => {
    const { campaign, partner } = await this.getCampaign(campaignId);
    const [incentives, customers, settlements] = await Promise.all([
      this.homechefIncentives(campaign),
      this.customerTotals(campaign),
      PartnerSettlement.find({ campaignId: campaign._id }).select("-lines").lean<PartnerSettlementDocument[]>(),
    ]);
    const sum = (list: PartnerSettlementDocument[], pick: (s: PartnerSettlementDocument) => number) =>
      roundMoney(list.reduce((acc, s) => acc + (pick(s) || 0), 0));
    const customerStatements = settlements.filter((s) => s.type === "customer_weekly");
    const paid = settlements.filter((s) => s.status === "paid");
    const pending = settlements.filter((s) => s.status === "finalized");
    const costDeducted = sum(customerStatements, (s) => s.totals?.allocatedCost ?? 0);
    const grossEarned = roundMoney(incentives.amount + customers.commission);
    const paidOut = sum(paid, (s) => s.totals?.payout ?? 0);
    const pendingPayout = sum(pending, (s) => s.totals?.payout ?? 0);

    return {
      header: this.header(campaign, partner),
      cards: {
        homechefIncentives: {
          amount: incentives.amount,
          successful: incentives.payable,
          perHomechef: incentives.perHomechef,
          caption: `${incentives.payable} successful × ₦${incentives.perHomechef.toLocaleString("en-NG")}`,
        },
        customerCommission: {
          amount: customers.commission,
          sharePercent: customers.sharePercent,
          towEarned: customers.towEarned,
          purchaseValue: customers.purchaseValue,
          caption: `${customers.sharePercent}% of ₦${customers.towEarned.toLocaleString("en-NG")} TOW earned`,
        },
        totalEarned: grossEarned,
        platformCostDeducted: costDeducted,
        paidOut,
        pendingPayout,
        // Earned but not yet in a finalized settlement (customer weeks not yet
        // finalized, HomeChef batches not yet full). Indicative only.
        notYetSettled: roundMoney(
          Math.max(
            0,
            grossEarned -
              sum(settlements.filter((s) => s.type === "homechef_batch"), (s) => s.totals?.payout ?? 0) -
              sum(customerStatements, (s) => s.totals?.share ?? 0),
          ),
        ),
      },
      breakdown: [
        { source: "homechef", activity: `${incentives.payable} successful HomeChefs`, amount: incentives.amount },
        { source: "customer", activity: "Qualifying purchases", amount: customers.commission },
        { source: "platform_cost", activity: "Platform cost deducted (finalized weeks)", amount: -costDeducted },
        { source: "total", activity: "Net earned", amount: roundMoney(grossEarned - costDeducted) },
      ],
    };
  };

  listEarningsActivity = async (
    campaignId: string,
    filters: Pagination & DateRange & { source?: "all" | "homechef" | "customer" | "payout"; search?: string },
  ) => {
    const { campaign } = await this.getCampaign(campaignId);
    const { page, limit } = paginate(filters);
    const rules = campaign.rules;
    const settlements = await PartnerSettlement.find({ campaignId: campaign._id })
      .select("-lines")
      .sort({ finalizedAt: 1 })
      .lean<PartnerSettlementDocument[]>();

    type Row = {
      id: string;
      source: "homechef" | "customer" | "payout";
      date: Date | null;
      description: string;
      amount: number;
      status: "earned" | "pending" | "paid";
      reference?: string | null;
      settlementId?: string | null;
    };
    const rows: Row[] = [];

    // HomeChef incentives, one row per batch.
    if (rules?.homechef) {
      const hc = rules.homechef;
      const batches = await Attribution.aggregate<{ _id: number; n: number; last: Date }>([
        { $match: { campaignId: campaign._id, qualificationRank: { $gte: 1, $lte: hc.payableCap } } },
        {
          $group: {
            _id: { $ceil: { $divide: ["$qualificationRank", hc.settlementBatchSize] } },
            n: { $sum: 1 },
            last: { $max: "$qualifiedAt" },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const byBatch = new Map(settlements.filter((s) => s.type === "homechef_batch").map((s) => [s.batchNumber as number, s]));
      for (const b of batches) {
        const s = byBatch.get(b._id);
        rows.push({
          id: `homechef-batch-${b._id}`,
          source: "homechef",
          date: s ? s.finalizedAt : b.last,
          description: `${b.n} successful HomeChef${b.n === 1 ? "" : "s"} (batch ${b._id}${s ? "" : `, ${b.n} of ${hc.settlementBatchSize}`})`,
          amount: roundMoney(b.n * hc.payoutPerHomechef),
          status: s ? (s.status === "paid" ? "paid" : "pending") : "earned",
          settlementId: s?.publicId ?? null,
        });
      }
    }

    // Customer commission, one row per WAT week with qualifying purchases.
    if (rules?.customer) {
      const pct = rules.customer.revenueSharePercent;
      const weeks = await Attribution.aggregate<{ _id: Date; orders: number; towEarned: number }>([
        { $match: { campaignId: campaign._id, subjectType: "customer", status: "active" } },
        qualifyingOrdersLookup(),
        { $unwind: "$orders" },
        { $project: { paidAt: "$orders.paidAt", towEarned: "$orders.towEarned" } },
        {
          $group: {
            _id: {
              $subtract: [
                "$paidAt",
                {
                  $mod: [
                    { $subtract: [{ $toLong: "$paidAt" }, { $toLong: new Date(watWeekStart(new Date(0)).getTime()) }] },
                    WEEK_MS,
                  ],
                },
              ],
            },
            orders: { $sum: 1 },
            towEarned: { $sum: "$towEarned" },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const byWeek = new Map(
        settlements.filter((s) => s.type === "customer_weekly").map((s) => [new Date(s.periodStart as Date).getTime(), s]),
      );
      for (const w of weeks) {
        const start = new Date(w._id).getTime();
        const s = byWeek.get(start);
        rows.push({
          id: `customer-week-${formatWatDate(new Date(start))}`,
          source: "customer",
          date: s ? s.finalizedAt : new Date(start),
          description: `Customer purchases, week of ${formatWatDate(new Date(start))} (${w.orders} order${w.orders === 1 ? "" : "s"})`,
          amount: s ? s.totals?.share ?? 0 : roundMoney((w.towEarned * pct) / 100),
          status: s ? (s.status === "paid" ? "paid" : "pending") : "earned",
          settlementId: s?.publicId ?? null,
        });
      }
    }

    // Payouts: every recorded settlement, numbered in finalize order.
    settlements.forEach((s, index) => {
      rows.push({
        id: s.publicId,
        source: "payout",
        date: s.paidAt ?? null,
        description:
          s.type === "homechef_batch"
            ? `Payout #${String(index + 1).padStart(3, "0")} · HomeChef batch ${s.batchNumber}`
            : `Payout #${String(index + 1).padStart(3, "0")} · Customer commission, week of ${formatWatDate(s.periodStart as Date)}`,
        amount: s.totals?.payout ?? 0,
        status: s.status === "paid" ? "paid" : "pending",
        reference: s.paymentReference ?? null,
        settlementId: s.publicId,
      });
    });

    const counts = {
      all: rows.filter((r) => r.source !== "payout").length,
      homechef: rows.filter((r) => r.source === "homechef").length,
      customer: rows.filter((r) => r.source === "customer").length,
      payout: rows.filter((r) => r.source === "payout").length,
    };

    const source = filters.source ?? "all";
    const search = filters.search?.toLowerCase();
    const filtered = rows
      .filter((r) => (source === "all" ? r.source !== "payout" : r.source === source))
      .filter((r) => {
        if (!filters.from && !filters.to) return true;
        if (!r.date) return false;
        const t = new Date(r.date).getTime();
        return (!filters.from || t >= filters.from.getTime()) && (!filters.to || t < filters.to.getTime());
      })
      .filter((r) => !search || r.description.toLowerCase().includes(search) || (r.reference ?? "").toLowerCase().includes(search))
      .sort((a, b) => {
        // Pending payouts (no date yet) first, then newest first.
        const ta = a.date ? new Date(a.date).getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.date ? new Date(b.date).getTime() : Number.MAX_SAFE_INTEGER;
        return tb - ta;
      });

    return {
      tabs: counts,
      items: filtered.slice((page - 1) * limit, page * limit),
      pagination: paginationResult(page, limit, filtered.length),
    };
  };
}

export const partnershipDashboardService = new PartnershipDashboardService();
