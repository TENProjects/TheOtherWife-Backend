/** @format */

import mongoose from "mongoose";

import Attribution from "../models/attribution.model.js";
import Order from "../models/order.model.js";
import PartnerSubmission from "../models/partnerSubmission.model.js";
import Vendor from "../models/vendor.model.js";
import { ReferralAdminService } from "./referral-admin.service.js";

import {
  attributionLiveState,
  classifyVendorLifecycle,
  csvEscape,
  getVendorSubmittedAt,
  VendorLifecycleSnapshot,
} from "../util/referral.util.js";

export type OrderDateBasis = "createdAt" | "paidAt";

// Every number below is computed on request from the existing source-of-truth
// collections (Vendor, Order) joined through Attribution — nothing is cached
// or pre-aggregated, and nothing is hard-coded per partner.
export const METRIC_DEFINITIONS = {
  homechefs: {
    referred:
      "Partner HomeChef submissions for this campaign, plus vendor attributions made directly with a code (no submission).",
    registered:
      "Distinct TOW vendor accounts attributed to this campaign (active attributions).",
    onboardingIncomplete:
      "Registered, Vendor.approvalStatus = pending, onboarding not yet submitted (no additionalData.onboarding.submittedAt).",
    pendingReview:
      "Registered, Vendor.approvalStatus = pending, onboarding submitted.",
    inspectionInProgress: "Registered, Vendor.inspectionStatus = in_progress.",
    inspected: "Registered, Vendor.inspectionStatus = completed.",
    approved: "Registered, Vendor.approvalStatus = approved right now.",
    everApproved:
      "Registered vendors that have been approved at least once (Attribution.firstApprovedAt or Vendor.approvedAt set), including those since suspended/rejected.",
    rejected: "Registered, Vendor.approvalStatus = rejected right now.",
    suspended: "Registered, Vendor.approvalStatus = suspended right now.",
    deleted: "Registered, but the vendor account no longer exists.",
    revoked: "Attributions revoked by an admin (excluded from every other count).",
    active: "UNRESOLVED — no definition of an 'active' HomeChef exists yet.",
    qualifying:
      "UNRESOLVED — the 'successful HomeChef' rule for the commercial target has not been decided; not reported.",
  },
  customers: {
    referred:
      "Partner customer submissions for this campaign, plus customer attributions made directly with a code (no submission).",
    registered: "Distinct TOW customer accounts attributed to this campaign.",
    activeAttribution: "Registered customers whose attribution window has not ended.",
    expiredAttribution: "Registered customers whose attribution window has ended.",
  },
  orders: {
    attributedOrders:
      "Orders by attributed customers whose date (see basis) falls within [attributedAt, expiresAt). All statuses.",
    paidOrders:
      "Attributed orders with paymentStatus = paid (the existing TOW revenue definition; refunds move to 'refunded').",
    paidTotalAmount: "Sum of Order.totalAmount over paidOrders (NGN).",
    paidSubtotalAmount:
      "Sum of Order.subtotal over paidOrders (NGN, excludes delivery, service charge and tax).",
    refundedOrders: "Attributed orders with paymentStatus = refunded.",
  },
};

type VendorRow = {
  _id: mongoose.Types.ObjectId;
  subjectUserId: mongoose.Types.ObjectId;
  firstApprovedAt?: Date;
  vendor: (NonNullable<VendorLifecycleSnapshot> & { approvedAt?: Date }) | null;
};

export class ReferralReportingService {
  private adminService = new ReferralAdminService();

  getCampaignMetrics = async (
    campaignId: string,
    options: { orderDateBasis?: OrderDateBasis } = {},
  ) => {
    const campaign = await this.adminService.getCampaign(campaignId);
    const campaignObjectId = campaign._id as mongoose.Types.ObjectId;
    const basis: OrderDateBasis = options.orderDateBasis ?? "createdAt";
    const now = new Date();

    const [
      homechefSubmissions,
      customerSubmissions,
      directVendorAttributions,
      directCustomerAttributions,
      revokedVendor,
      revokedCustomer,
      vendorRows,
      customerAttributions,
      orderAgg,
    ] = await Promise.all([
      PartnerSubmission.countDocuments({ campaignId: campaignObjectId, type: "homechef" }),
      PartnerSubmission.countDocuments({ campaignId: campaignObjectId, type: "customer" }),
      Attribution.countDocuments({
        campaignId: campaignObjectId,
        subjectType: "vendor",
        partnerSubmissionId: { $exists: false },
      }),
      Attribution.countDocuments({
        campaignId: campaignObjectId,
        subjectType: "customer",
        partnerSubmissionId: { $exists: false },
      }),
      Attribution.countDocuments({
        campaignId: campaignObjectId,
        subjectType: "vendor",
        status: "revoked",
      }),
      Attribution.countDocuments({
        campaignId: campaignObjectId,
        subjectType: "customer",
        status: "revoked",
      }),
      Attribution.aggregate<VendorRow>([
        {
          $match: {
            campaignId: campaignObjectId,
            subjectType: "vendor",
            status: "active",
          },
        },
        {
          $lookup: {
            from: Vendor.collection.name,
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
          },
        },
        {
          $project: {
            subjectUserId: 1,
            firstApprovedAt: 1,
            vendor: { $arrayElemAt: ["$vendor", 0] },
          },
        },
        {
          $project: {
            subjectUserId: 1,
            firstApprovedAt: 1,
            "vendor.approvalStatus": 1,
            "vendor.inspectionStatus": 1,
            "vendor.approvedAt": 1,
            "vendor.additionalData.onboarding.submittedAt": 1,
          },
        },
      ]),
      Attribution.find({
        campaignId: campaignObjectId,
        subjectType: "customer",
        status: "active",
      })
        .select("status expiresAt")
        .lean(),
      Attribution.aggregate<{
        attributedOrders: number;
        paidOrders: number;
        paidTotalAmount: number;
        paidSubtotalAmount: number;
        refundedOrders: number;
        orderingCustomers: number;
      }>([
        {
          $match: {
            campaignId: campaignObjectId,
            subjectType: "customer",
            status: "active",
          },
        },
        {
          $lookup: {
            from: Order.collection.name,
            let: { uid: "$subjectUserId", start: "$attributedAt", end: "$expiresAt" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$customerId", "$$uid"] },
                      { $gte: [`$${basis}`, "$$start"] },
                      { $lt: [`$${basis}`, "$$end"] },
                    ],
                  },
                },
              },
              { $project: { paymentStatus: 1, totalAmount: 1, subtotal: 1 } },
            ],
            as: "orders",
          },
        },
        { $unwind: "$orders" },
        {
          $group: {
            _id: null,
            attributedOrders: { $sum: 1 },
            paidOrders: {
              $sum: { $cond: [{ $eq: ["$orders.paymentStatus", "paid"] }, 1, 0] },
            },
            paidTotalAmount: {
              $sum: {
                $cond: [
                  { $eq: ["$orders.paymentStatus", "paid"] },
                  "$orders.totalAmount",
                  0,
                ],
              },
            },
            paidSubtotalAmount: {
              $sum: {
                $cond: [
                  { $eq: ["$orders.paymentStatus", "paid"] },
                  "$orders.subtotal",
                  0,
                ],
              },
            },
            refundedOrders: {
              $sum: { $cond: [{ $eq: ["$orders.paymentStatus", "refunded"] }, 1, 0] },
            },
            customers: { $addToSet: "$subjectUserId" },
          },
        },
        {
          $project: {
            _id: 0,
            attributedOrders: 1,
            paidOrders: 1,
            paidTotalAmount: 1,
            paidSubtotalAmount: 1,
            refundedOrders: 1,
            orderingCustomers: { $size: "$customers" },
          },
        },
      ]),
    ]);

    const homechefs = {
      referred: homechefSubmissions + directVendorAttributions,
      registered: vendorRows.length,
      onboardingIncomplete: 0,
      pendingReview: 0,
      inspectionInProgress: 0,
      inspected: 0,
      approved: 0,
      everApproved: 0,
      rejected: 0,
      suspended: 0,
      deleted: 0,
      revoked: revokedVendor,
      active: null as number | null,
      qualifying: null as number | null,
    };

    for (const row of vendorRows) {
      const vendor = row.vendor && Object.keys(row.vendor).length ? row.vendor : null;
      const bucket = classifyVendorLifecycle(vendor);
      switch (bucket) {
        case "onboarding_incomplete":
          homechefs.onboardingIncomplete += 1;
          break;
        case "pending_review":
          homechefs.pendingReview += 1;
          break;
        default:
          homechefs[bucket] += 1;
      }
      if (vendor?.inspectionStatus === "in_progress") homechefs.inspectionInProgress += 1;
      if (vendor?.inspectionStatus === "completed") homechefs.inspected += 1;
      if (vendor && (row.firstApprovedAt || vendor.approvedAt)) homechefs.everApproved += 1;
    }

    let activeAttribution = 0;
    let expiredAttribution = 0;
    for (const attribution of customerAttributions) {
      if (attributionLiveState(attribution as any, now) === "expired") {
        expiredAttribution += 1;
      } else {
        activeAttribution += 1;
      }
    }

    const orders = orderAgg[0] ?? {
      attributedOrders: 0,
      paidOrders: 0,
      paidTotalAmount: 0,
      paidSubtotalAmount: 0,
      refundedOrders: 0,
      orderingCustomers: 0,
    };

    return {
      generatedAt: now,
      campaign: {
        id: campaign._id,
        name: campaign.name,
        programType: campaign.programType,
        partnerId: campaign.partnerId ?? null,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt ?? null,
        customerAttributionDays: campaign.customerAttributionDays,
        claimWindowDays: campaign.claimWindowDays,
        targets: campaign.targets ?? {},
      },
      homechefs: {
        ...homechefs,
        target: campaign.targets?.homechefs ?? null,
        // Progress is only meaningful once the qualifying rule is decided.
        targetProgress: null as number | null,
      },
      customers: {
        referred: customerSubmissions + directCustomerAttributions,
        registered: customerAttributions.length,
        activeAttribution,
        expiredAttribution,
        revoked: revokedCustomer,
        target: campaign.targets?.customers ?? null,
      },
      orders: { basis, ...orders },
      definitions: METRIC_DEFINITIONS,
    };
  };

  exportCampaignCsv = async (campaignId: string): Promise<string> => {
    const campaign = await this.adminService.getCampaign(campaignId);
    const now = new Date();

    const rows = await Attribution.find({ campaignId: campaign._id })
      .select("-events")
      .sort({ attributedAt: 1 })
      .populate("subjectUserId", "firstName lastName email")
      .lean();

    const vendorIds = rows
      .map((row) => row.vendorId)
      .filter((id): id is mongoose.Types.ObjectId => !!id);
    const vendors = await Vendor.find({ _id: { $in: vendorIds } })
      .select("approvalStatus inspectionStatus approvedAt additionalData.onboarding.submittedAt")
      .lean();
    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));

    const header = [
      "Attribution ID",
      "Subject Type",
      "User ID",
      "Name",
      "Email",
      "Code",
      "Channel",
      "External Ref",
      "Attributed At",
      "Expires At",
      "Attribution State",
      "Vendor Lifecycle",
      "Inspection Status",
      "Onboarding Submitted At",
      "Vendor Approved At",
      "First Approved After Attribution",
    ];

    const lines = rows.map((row) => {
      const user = row.subjectUserId as unknown as
        | { _id: mongoose.Types.ObjectId; firstName?: string; lastName?: string; email?: string }
        | null;
      const vendor = row.vendorId ? vendorById.get(row.vendorId.toString()) ?? null : null;
      const isVendor = row.subjectType === "vendor";
      return [
        row._id.toString(),
        row.subjectType,
        user?._id?.toString() ?? "",
        user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "",
        user?.email ?? "",
        row.codeSnapshot,
        row.channel,
        row.externalRef ?? "",
        row.attributedAt?.toISOString() ?? "",
        row.expiresAt?.toISOString() ?? "",
        attributionLiveState(row as any, now),
        isVendor ? classifyVendorLifecycle(vendor as VendorLifecycleSnapshot) : "",
        isVendor ? vendor?.inspectionStatus ?? "" : "",
        isVendor ? getVendorSubmittedAt(vendor as VendorLifecycleSnapshot) ?? "" : "",
        isVendor ? vendor?.approvedAt?.toISOString() ?? "" : "",
        row.firstApprovedAt?.toISOString() ?? "",
      ]
        .map(csvEscape)
        .join(",");
    });

    return [header.map(csvEscape).join(","), ...lines].join("\n");
  };
}

export const referralReportingService = new ReferralReportingService();
