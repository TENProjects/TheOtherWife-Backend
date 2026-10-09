/** @format */

import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Attribution from "../models/attribution.model.js";
import Order from "../models/order.model.js";
import PartnerSettlement, {
  PartnerSettlementDocument,
} from "../models/partnerSettlement.model.js";
import Payment from "../models/payment.model.js";
import PlatformCost from "../models/platformCost.model.js";
import ReferralCampaign, {
  DEFAULT_COST_SHARING,
  ReferralCampaignDocument,
} from "../models/referralCampaign.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";

import {
  classifyVendorLifecycle,
  computePartnerPayout,
  formatWatDate,
  generatePublicId,
  homechefBatchCount,
  homechefBatchRange,
  monthsInRange,
  parseWatWeekStart,
  platformCostForRange,
  roundMoney,
  towEarnedOnOrder,
  watWeekStart,
  WEEK_MS,
} from "../util/referral.util.js";
import { paginate, Pagination, paginationResult } from "../util/pagination.util.js";

type ObjectId = mongoose.Types.ObjectId;

const badRequest = (message: string) =>
  new BadRequestException(message, HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
const conflict = (message: string) =>
  new AppError(message, HttpStatus.CONFLICT, ErrorCode.RESOURCE_CONFLICT);
const notFound = (what: string) =>
  new NotFoundException(`${what} not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);

type OrderEarning = {
  orderId: string;
  customerId: string;
  paidAt: Date;
  platformFee: number;
  serviceCharge: number;
  paystackFee: number;
  towEarned: number;
};

type CustomerLine = OrderEarning & { partnerShare: number };

type Adjustment = {
  kind: "refund_reversal" | "carry_forward";
  amount: number;
  orderId?: string;
  fromSettlementId?: string;
  note: string;
};

// Partner settlements (agreed rules). Calculates and RECORDS what a partner is
// owed; it never moves money. See models/partnerSettlement.model.ts.
export class PartnerSettlementService {
  // ── Shared ────────────────────────────────────────────────────────────

  private getCampaign = async (campaignId: string): Promise<ReferralCampaignDocument> => {
    if (!mongoose.isValidObjectId(campaignId)) throw badRequest("Invalid campaign id");
    const campaign = await ReferralCampaign.findById(campaignId);
    if (!campaign) throw notFound("Campaign");
    return campaign;
  };

  private parseWeek = (weekStart: string) => {
    const start = parseWatWeekStart(weekStart);
    if (!start) throw badRequest("weekStart must be a Monday in YYYY-MM-DD format (WAT)");
    return { start, end: new Date(start.getTime() + WEEK_MS) };
  };

  // TOW earned per order for a set of orders (agreed definition):
  // Σ succeeded Payment.vendorPlatformFeeAmount + Order.serviceCharge
  // − Σ succeeded Payment.paystackFeeAmount.
  private earningsForOrders = async (
    orders: Array<{ _id: ObjectId; customerId: ObjectId; paidAt: Date; serviceCharge?: number }>,
  ): Promise<OrderEarning[]> => {
    if (!orders.length) return [];
    const payments = await Payment.find({
      orderId: { $in: orders.map((o) => o._id) },
      status: "succeeded",
      context: "order",
    })
      .select("orderId vendorPlatformFeeAmount paystackFeeAmount")
      .lean<Array<{ orderId: ObjectId; vendorPlatformFeeAmount?: number; paystackFeeAmount?: number }>>();
    const fees = new Map<string, { platformFee: number; paystackFee: number }>();
    for (const p of payments) {
      const key = String(p.orderId);
      const current = fees.get(key) ?? { platformFee: 0, paystackFee: 0 };
      current.platformFee += p.vendorPlatformFeeAmount ?? 0;
      current.paystackFee += p.paystackFeeAmount ?? 0;
      fees.set(key, current);
    }
    return orders.map((o) => {
      const f = fees.get(String(o._id)) ?? { platformFee: 0, paystackFee: 0 };
      const serviceCharge = o.serviceCharge ?? 0;
      return {
        orderId: String(o._id),
        customerId: String(o.customerId),
        paidAt: o.paidAt,
        platformFee: roundMoney(f.platformFee),
        serviceCharge: roundMoney(serviceCharge),
        paystackFee: roundMoney(f.paystackFee),
        towEarned: roundMoney(
          towEarnedOnOrder({ platformFee: f.platformFee, serviceCharge, paystackFee: f.paystackFee }),
        ),
      };
    });
  };

  // TOW earned across ALL orders paid in the period (for cost allocation).
  private platformEarnedForRange = async (start: Date, end: Date): Promise<number> => {
    const [agg] = await Order.aggregate<{ total: number }>([
      {
        $match: {
          paidAt: { $gte: start, $lt: end },
          paymentStatus: "paid",
          status: { $ne: "cancelled" },
        },
      },
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
          earned: {
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
      { $group: { _id: null, total: { $sum: "$earned" } } },
    ]);
    return agg?.total ?? 0;
  };

  // ── Customer weekly statements ─────────────────────────────────────────

  private computeCustomerWeek = async (campaign: ReferralCampaignDocument, start: Date, end: Date) => {
    const rules = campaign.rules?.customer;
    if (!rules) throw badRequest("This campaign has no customer revenue-share rules");

    const attributions = await Attribution.find({
      campaignId: campaign._id,
      subjectType: "customer",
      status: "active",
    })
      .select("subjectUserId attributedAt expiresAt")
      .lean<Array<{ subjectUserId: ObjectId; attributedAt: Date; expiresAt?: Date }>>();
    const windowByCustomer = new Map(
      attributions.map((a) => [String(a.subjectUserId), { from: a.attributedAt, to: a.expiresAt }]),
    );

    const orders = attributions.length
      ? await Order.find({
          customerId: { $in: attributions.map((a) => a.subjectUserId) },
          paidAt: { $gte: start, $lt: end },
          paymentStatus: "paid",
          status: { $ne: "cancelled" },
        })
          .select("customerId paidAt serviceCharge")
          .lean<Array<{ _id: ObjectId; customerId: ObjectId; paidAt: Date; serviceCharge?: number }>>()
      : [];
    const inWindow = orders.filter((o) => {
      const w = windowByCustomer.get(String(o.customerId));
      if (!w) return false;
      const t = o.paidAt.getTime();
      return t >= w.from.getTime() && (!w.to || t < w.to.getTime());
    });

    const earnings = await this.earningsForOrders(inWindow);
    const lines: CustomerLine[] = earnings
      .map((e) => ({ ...e, partnerShare: roundMoney((e.towEarned * rules.revenueSharePercent) / 100) }))
      .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    const partnerEarned = earnings.reduce((sum, e) => sum + e.towEarned, 0);

    // Earlier finalized statements: refund reversals + carry-forward.
    const previous = await PartnerSettlement.find({
      campaignId: campaign._id,
      type: "customer_weekly",
      periodStart: { $lt: start },
    })
      .sort({ periodStart: 1 })
      .lean<PartnerSettlementDocument[]>();

    const reversed = new Set<string>();
    for (const s of previous) {
      for (const a of (s.adjustments ?? []) as Adjustment[]) {
        if (a.kind === "refund_reversal" && a.orderId) reversed.add(a.orderId);
      }
    }
    const paidLines = new Map<string, { share: number; settlementId: string }>();
    for (const s of previous) {
      for (const l of (s.lines ?? []) as unknown as CustomerLine[]) {
        if (!reversed.has(l.orderId)) paidLines.set(l.orderId, { share: l.partnerShare, settlementId: s.publicId });
      }
    }
    const adjustments: Adjustment[] = [];
    if (paidLines.size) {
      const nowUndone = await Order.find({
        _id: { $in: Array.from(paidLines.keys()) },
        $or: [{ paymentStatus: "refunded" }, { status: "cancelled" }],
      })
        .select("_id paymentStatus status")
        .lean<Array<{ _id: ObjectId; paymentStatus: string; status: string }>>();
      for (const o of nowUndone) {
        const line = paidLines.get(String(o._id))!;
        adjustments.push({
          kind: "refund_reversal",
          amount: roundMoney(-line.share),
          orderId: String(o._id),
          fromSettlementId: line.settlementId,
          note: `Order ${o.paymentStatus === "refunded" ? "refunded" : "cancelled"} after statement ${line.settlementId} was finalized`,
        });
      }
    }
    const last = previous[previous.length - 1];
    if (last && last.carryForward < 0) {
      adjustments.push({
        kind: "carry_forward",
        amount: roundMoney(last.carryForward),
        fromSettlementId: last.publicId,
        note: `Shortfall carried from the week of ${formatWatDate(last.periodStart as Date)}`,
      });
    }
    const adjustmentsTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);

    // Platform cost for the week.
    const months = monthsInRange(start, end);
    const costs = await PlatformCost.find({ month: { $in: months } })
      .select("month amount")
      .lean<Array<{ month: string; amount: number }>>();
    const { cost: periodCost, missingMonths } = platformCostForRange(
      start,
      end,
      new Map(costs.map((c) => [c.month, c.amount])),
    );
    const totalEarned = rules.deductPlatformCost ? await this.platformEarnedForRange(start, end) : 0;
    const costSharing = rules.costSharing ?? DEFAULT_COST_SHARING;

    const totals = computePartnerPayout({
      partnerEarned,
      totalEarned,
      sharePercent: rules.revenueSharePercent,
      periodCost,
      deductPlatformCost: rules.deductPlatformCost,
      adjustmentsTotal,
      costSharing,
    });

    // Finalize rules: week ended, not already finalized, strictly the week
    // after the latest finalized one (no gaps, no going back), cost entered.
    const existing = await PartnerSettlement.findOne({
      campaignId: campaign._id,
      type: "customer_weekly",
      periodStart: start,
    }).lean<PartnerSettlementDocument>();
    const latest = await PartnerSettlement.findOne({ campaignId: campaign._id, type: "customer_weekly" })
      .sort({ periodStart: -1 })
      .select("periodStart")
      .lean<{ periodStart: Date }>();
    // Weeks are finalized strictly in order starting from the campaign's first
    // week, so no week's earnings can ever be skipped or settled twice.
    const firstWeek = watWeekStart(new Date(campaign.startsAt));
    const nextDue = latest ? new Date(latest.periodStart.getTime() + WEEK_MS) : firstWeek;
    const blockers: string[] = [];
    if (end.getTime() > Date.now()) blockers.push("The week has not ended yet");
    if (existing) blockers.push("This week is already finalized");
    else if (start.getTime() < firstWeek.getTime()) {
      blockers.push("This week is before the campaign started");
    } else if (latest && latest.periodStart.getTime() >= start.getTime()) {
      blockers.push("A later week is already finalized");
    } else if (start.getTime() !== nextDue.getTime()) {
      blockers.push(`Finalize the week of ${formatWatDate(nextDue)} first (weeks are finalized in order)`);
    }
    if (rules.deductPlatformCost && missingMonths.length) {
      blockers.push(`Enter the platform cost for ${missingMonths.join(", ")} first (0 is allowed)`);
    }

    return {
      week: { weekStart: formatWatDate(start), start, end },
      sharePercent: rules.revenueSharePercent,
      deductPlatformCost: rules.deductPlatformCost,
      costSharing,
      lines,
      adjustments,
      totals: { ...totals, orders: lines.length },
      missingCostMonths: missingMonths,
      existing,
      blockers,
    };
  };

  // Lists the campaign's weeks (newest first) with their state:
  // in_progress (current week) | ready (ended, not finalized) | finalized | paid.
  listCustomerWeeks = async (campaignId: string, pagination: Pagination) => {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign.rules?.customer) throw badRequest("This campaign has no customer revenue-share rules");
    const first = watWeekStart(campaign.startsAt).getTime();
    const current = watWeekStart(new Date()).getTime();
    const total = current >= first ? Math.floor((current - first) / WEEK_MS) + 1 : 0;
    const { page, limit, skip } = paginate(pagination);

    const weeks: Date[] = [];
    for (let i = skip; i < Math.min(skip + limit, total); i++) {
      weeks.push(new Date(current - i * WEEK_MS));
    }
    const settlements = weeks.length
      ? await PartnerSettlement.find({
          campaignId: campaign._id,
          type: "customer_weekly",
          periodStart: { $in: weeks },
        })
          .select("publicId periodStart status totals finalizedAt paidAt")
          .lean<PartnerSettlementDocument[]>()
      : [];
    const byStart = new Map(settlements.map((s) => [(s.periodStart as Date).getTime(), s]));
    const items = weeks.map((start) => {
      const s = byStart.get(start.getTime());
      const ended = start.getTime() + WEEK_MS <= Date.now();
      return {
        weekStart: formatWatDate(start),
        start,
        end: new Date(start.getTime() + WEEK_MS),
        state: s ? s.status : ended ? "ready" : "in_progress",
        settlementId: s?.publicId ?? null,
        payout: s ? s.totals?.payout ?? null : null,
        finalizedAt: s?.finalizedAt ?? null,
        paidAt: s?.paidAt ?? null,
      };
    });
    return { items, pagination: paginationResult(page, limit, total) };
  };

  // Preview (or, if finalized, the recorded snapshot) of one week.
  getCustomerWeek = async (campaignId: string, weekStart: string, pagination: Pagination) => {
    const campaign = await this.getCampaign(campaignId);
    const { start, end } = this.parseWeek(weekStart);
    const { page, limit, skip } = paginate(pagination);

    const recorded = await PartnerSettlement.findOne({
      campaignId: campaign._id,
      type: "customer_weekly",
      periodStart: start,
    }).lean<PartnerSettlementDocument>();
    if (recorded) {
      return {
        state: recorded.status,
        settlement: this.settlementView(recorded),
        week: { weekStart: formatWatDate(start), start, end },
        costSharing: this.recordedCostSharing(recorded),
        totals: this.recordedTotals(recorded),
        adjustments: recorded.adjustments,
        canFinalize: false,
        blockers: ["This week is already finalized"],
        items: recorded.lines.slice(skip, skip + limit),
        pagination: paginationResult(page, limit, recorded.lines.length),
      };
    }

    const computed = await this.computeCustomerWeek(campaign, start, end);
    return {
      state: end.getTime() <= Date.now() ? "ready" : "in_progress",
      settlement: null,
      week: computed.week,
      sharePercent: computed.sharePercent,
      deductPlatformCost: computed.deductPlatformCost,
      costSharing: computed.costSharing,
      totals: computed.totals,
      adjustments: computed.adjustments,
      missingCostMonths: computed.missingCostMonths,
      canFinalize: computed.blockers.length === 0,
      blockers: computed.blockers,
      items: computed.lines.slice(skip, skip + limit),
      pagination: paginationResult(page, limit, computed.lines.length),
    };
  };

  finalizeCustomerWeek = async (adminUserId: string, campaignId: string, weekStart: string) => {
    const campaign = await this.getCampaign(campaignId);
    const { start, end } = this.parseWeek(weekStart);
    const computed = await this.computeCustomerWeek(campaign, start, end);
    if (computed.blockers.length) throw conflict(computed.blockers.join(". "));

    try {
      const settlement = await PartnerSettlement.create({
        publicId: generatePublicId("pstl"),
        campaignId: campaign._id,
        partnerId: campaign.partnerId,
        type: "customer_weekly",
        periodStart: start,
        periodEnd: end,
        status: "finalized",
        currency: "NGN",
        lines: computed.lines,
        adjustments: computed.adjustments,
        totals: { ...computed.totals, sharePercent: computed.sharePercent },
        costSharing: computed.costSharing,
        carryForward: computed.totals.carryForward,
        finalizedBy: adminUserId,
        finalizedAt: new Date(),
      });
      return { settlement: this.settlementView(settlement.toObject()) };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) throw conflict("This week is already finalized");
      throw error;
    }
  };

  // ── HomeChef batches ──────────────────────────────────────────────────

  private homechefRules = (campaign: ReferralCampaignDocument) => {
    const rules = campaign.rules?.homechef;
    if (!rules) throw badRequest("This campaign has no HomeChef rules");
    return rules;
  };

  listHomechefBatches = async (campaignId: string) => {
    const campaign = await this.getCampaign(campaignId);
    const rules = this.homechefRules(campaign);
    const count = homechefBatchCount(rules.settlementBatchSize, rules.payableCap);

    const [rankCounts, settlements] = await Promise.all([
      Attribution.aggregate<{ _id: number; count: number }>([
        {
          $match: {
            campaignId: campaign._id,
            qualificationRank: { $gte: 1, $lte: rules.payableCap },
          },
        },
        {
          $group: {
            _id: { $ceil: { $divide: ["$qualificationRank", rules.settlementBatchSize] } },
            count: { $sum: 1 },
          },
        },
      ]),
      PartnerSettlement.find({ campaignId: campaign._id, type: "homechef_batch" })
        .select("publicId batchNumber status totals finalizedAt paidAt")
        .lean<PartnerSettlementDocument[]>(),
    ]);
    const qualifiedByBatch = new Map(rankCounts.map((r) => [r._id, r.count]));
    const settlementByBatch = new Map(settlements.map((s) => [s.batchNumber as number, s]));

    const items = Array.from({ length: count }, (_, i) => {
      const batchNumber = i + 1;
      const range = homechefBatchRange(batchNumber, rules.settlementBatchSize, rules.payableCap);
      const qualified = qualifiedByBatch.get(batchNumber) ?? 0;
      const s = settlementByBatch.get(batchNumber);
      return {
        batchNumber,
        ranks: { from: range.from, to: range.to },
        size: range.size,
        qualified,
        amount: roundMoney(range.size * rules.payoutPerHomechef),
        state: s ? s.status : qualified >= range.size ? "ready" : "pending",
        settlementId: s?.publicId ?? null,
        finalizedAt: s?.finalizedAt ?? null,
        paidAt: s?.paidAt ?? null,
      };
    });
    const payable = Math.min(campaign.qualifiedCount ?? 0, rules.payableCap);
    return {
      payoutPerHomechef: rules.payoutPerHomechef,
      batchSize: rules.settlementBatchSize,
      payableCap: rules.payableCap,
      qualified: campaign.qualifiedCount ?? 0,
      payable,
      items,
    };
  };

  getHomechefBatch = async (campaignId: string, batchNumber: number, pagination: Pagination) => {
    const campaign = await this.getCampaign(campaignId);
    const rules = this.homechefRules(campaign);
    const count = homechefBatchCount(rules.settlementBatchSize, rules.payableCap);
    if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > count) {
      throw badRequest(`batchNumber must be between 1 and ${count}`);
    }
    const range = homechefBatchRange(batchNumber, rules.settlementBatchSize, rules.payableCap);
    const { page, limit, skip } = paginate(pagination);
    const filter = { campaignId: campaign._id, qualificationRank: { $gte: range.from, $lte: range.to } };

    const [rows, total, settlement] = await Promise.all([
      Attribution.find(filter)
        .sort({ qualificationRank: 1 })
        .skip(skip)
        .limit(limit)
        .select("subjectUserId vendorId externalRef qualificationRank qualificationTier qualifiedAt attributedAt")
        .lean(),
      Attribution.countDocuments(filter),
      PartnerSettlement.findOne({ campaignId: campaign._id, type: "homechef_batch", batchNumber })
        .lean<PartnerSettlementDocument>(),
    ]);
    const items = await this.describeHomechefRows(rows as any[]);
    return {
      batchNumber,
      ranks: { from: range.from, to: range.to },
      amount: roundMoney(range.size * rules.payoutPerHomechef),
      state: settlement ? settlement.status : total >= range.size ? "ready" : "pending",
      settlement: settlement ? this.settlementView(settlement) : null,
      items,
      pagination: paginationResult(page, limit, total),
    };
  };

  private describeHomechefRows = async (
    rows: Array<{ _id: ObjectId; subjectUserId: ObjectId; vendorId?: ObjectId; externalRef?: string; qualificationRank?: number; qualificationTier?: string; qualifiedAt?: Date; attributedAt: Date }>,
  ) => {
    const [users, vendors] = await Promise.all([
      User.find({ _id: { $in: rows.map((r) => r.subjectUserId) } })
        .select("firstName lastName email")
        .lean<Array<{ _id: ObjectId; firstName?: string; lastName?: string; email?: string }>>(),
      Vendor.find({ _id: { $in: rows.map((r) => r.vendorId).filter(Boolean) } })
        .select("businessName approvalStatus inspectionStatus additionalData.onboarding.submittedAt")
        .lean<Array<{ _id: ObjectId; businessName?: string; approvalStatus?: string; inspectionStatus?: string; additionalData?: unknown }>>(),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));
    return rows.map((r) => {
      const user = userById.get(String(r.subjectUserId));
      const vendor = r.vendorId ? vendorById.get(String(r.vendorId)) ?? null : null;
      return {
        attributionId: String(r._id),
        rank: r.qualificationRank,
        tier: r.qualificationTier,
        qualifiedAt: r.qualifiedAt,
        attributedAt: r.attributedAt,
        externalRef: r.externalRef ?? null,
        name: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : null,
        email: user?.email ?? null,
        businessName: vendor?.businessName ?? null,
        currentStatus: classifyVendorLifecycle(vendor as any),
      };
    });
  };

  finalizeHomechefBatch = async (adminUserId: string, campaignId: string, batchNumber: number) => {
    const campaign = await this.getCampaign(campaignId);
    const rules = this.homechefRules(campaign);
    const count = homechefBatchCount(rules.settlementBatchSize, rules.payableCap);
    if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > count) {
      throw badRequest(`batchNumber must be between 1 and ${count}`);
    }
    const range = homechefBatchRange(batchNumber, rules.settlementBatchSize, rules.payableCap);
    const rows = await Attribution.find({
      campaignId: campaign._id,
      qualificationRank: { $gte: range.from, $lte: range.to },
    })
      .sort({ qualificationRank: 1 })
      .select("subjectUserId vendorId externalRef qualificationRank qualificationTier qualifiedAt attributedAt")
      .lean();
    if (rows.length < range.size) {
      throw conflict(`Batch ${batchNumber} is not full yet (${rows.length} of ${range.size} successful HomeChefs)`);
    }
    const described = await this.describeHomechefRows(rows as any[]);
    const lines = described.map((d) => ({ ...d, amount: rules.payoutPerHomechef }));
    try {
      const settlement = await PartnerSettlement.create({
        publicId: generatePublicId("pstl"),
        campaignId: campaign._id,
        partnerId: campaign.partnerId,
        type: "homechef_batch",
        batchNumber,
        status: "finalized",
        currency: "NGN",
        lines,
        adjustments: [],
        totals: {
          homechefs: lines.length,
          payoutPerHomechef: rules.payoutPerHomechef,
          payout: roundMoney(lines.length * rules.payoutPerHomechef),
          rankFrom: range.from,
          rankTo: range.to,
        },
        carryForward: 0,
        finalizedBy: adminUserId,
        finalizedAt: new Date(),
      });
      return { settlement: this.settlementView(settlement.toObject()) };
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) throw conflict(`Batch ${batchNumber} is already finalized`);
      throw error;
    }
  };

  // ── Recorded settlements ──────────────────────────────────────────────

  // Weekly statements finalized before cost sharing was configurable all used
  // partner_absorbs, where the cost deducted equals the allocated cost.
  private recordedCostSharing = (s: PartnerSettlementDocument | Record<string, any>) =>
    s.type === "customer_weekly" ? (s.costSharing ?? DEFAULT_COST_SHARING) : null;

  private recordedTotals = (s: PartnerSettlementDocument | Record<string, any>) =>
    s.type === "customer_weekly" && s.totals && s.totals.costDeducted === undefined
      ? { ...s.totals, costDeducted: s.totals.allocatedCost ?? 0 }
      : s.totals;

  private settlementView = (s: PartnerSettlementDocument | Record<string, any>) => ({
    settlementId: s.publicId,
    type: s.type,
    status: s.status,
    weekStart: s.periodStart ? formatWatDate(s.periodStart) : null,
    periodStart: s.periodStart ?? null,
    periodEnd: s.periodEnd ?? null,
    batchNumber: s.batchNumber ?? null,
    currency: s.currency,
    costSharing: this.recordedCostSharing(s),
    totals: this.recordedTotals(s),
    adjustments: s.adjustments ?? [],
    carryForward: s.carryForward ?? 0,
    lineCount: (s.lines ?? []).length,
    finalizedBy: s.finalizedBy ?? null,
    finalizedAt: s.finalizedAt ?? null,
    paidBy: s.paidBy ?? null,
    paidAt: s.paidAt ?? null,
    paymentReference: s.paymentReference ?? null,
  });

  listSettlements = async (
    campaignId: string,
    filters: Pagination & { type?: "customer_weekly" | "homechef_batch"; status?: "finalized" | "paid" },
  ) => {
    const campaign = await this.getCampaign(campaignId);
    const { page, limit, skip } = paginate(filters);
    const query: Record<string, unknown> = { campaignId: campaign._id };
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    const [rows, total] = await Promise.all([
      PartnerSettlement.find(query).select("-lines").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PartnerSettlement.countDocuments(query),
    ]);
    return { items: rows.map((r) => this.settlementView(r as any)), pagination: paginationResult(page, limit, total) };
  };

  getSettlement = async (settlementId: string, pagination: Pagination) => {
    const settlement = await PartnerSettlement.findOne({ publicId: settlementId }).lean<PartnerSettlementDocument>();
    if (!settlement) throw notFound("Settlement");
    const { page, limit, skip } = paginate(pagination);
    return {
      settlement: this.settlementView(settlement),
      items: settlement.lines.slice(skip, skip + limit),
      pagination: paginationResult(page, limit, settlement.lines.length),
    };
  };

  markPaid = async (
    adminUserId: string,
    settlementId: string,
    body: { paymentReference: string; paidAt?: Date },
  ) => {
    const paidAt = body.paidAt ?? new Date();
    if (paidAt.getTime() > Date.now() + 60_000) throw badRequest("paidAt cannot be in the future");
    const settlement = await PartnerSettlement.findOneAndUpdate(
      { publicId: settlementId, status: "finalized" },
      { $set: { status: "paid", paidAt, paidBy: adminUserId, paymentReference: body.paymentReference } },
      { new: true },
    ).lean<PartnerSettlementDocument>();
    if (!settlement) {
      const exists = await PartnerSettlement.exists({ publicId: settlementId });
      if (!exists) throw notFound("Settlement");
      throw conflict("This settlement is already marked as paid");
    }
    return { settlement: this.settlementView(settlement) };
  };

  // ── Platform costs ────────────────────────────────────────────────────

  listPlatformCosts = async (pagination: Pagination) => {
    const { page, limit, skip } = paginate(pagination);
    const [rows, total] = await Promise.all([
      PlatformCost.find().sort({ month: -1 }).skip(skip).limit(limit).lean(),
      PlatformCost.countDocuments(),
    ]);
    return { items: rows, pagination: paginationResult(page, limit, total) };
  };

  upsertPlatformCost = async (
    adminUserId: string,
    month: string,
    body: { amount: number; note?: string },
  ) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest("month must be YYYY-MM");
    // A month already used by a finalized weekly statement is locked, so a
    // recorded settlement can never silently disagree with the cost table.
    const [y, m] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1) - 60 * 60 * 1000);
    const monthEnd = new Date(Date.UTC(y, m, 1) - 60 * 60 * 1000);
    const used = await PartnerSettlement.exists({
      type: "customer_weekly",
      periodStart: { $lt: monthEnd },
      periodEnd: { $gt: monthStart },
    });
    if (used) throw conflict(`The platform cost for ${month} is already used by a finalized statement`);

    const cost = await PlatformCost.findOneAndUpdate(
      { month },
      { $set: { amount: body.amount, note: body.note, updatedBy: adminUserId, currency: "NGN" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return { platformCost: cost };
  };
}

export const partnerSettlementService = new PartnerSettlementService();
