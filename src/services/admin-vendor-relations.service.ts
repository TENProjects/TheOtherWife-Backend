/** @format */

import mongoose from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import Vendor from "../models/vendor.model.js";
import User from "../models/user.model.js";
import Order from "../models/order.model.js";
import RefundRequest from "../models/refundRequest.model.js";
import VendorIssue, {
  VendorIssueCategory,
  VendorIssuePriority,
} from "../models/vendorIssue.model.js";
import VendorWarning from "../models/vendorWarning.model.js";
import VendorMessage from "../models/vendorMessage.model.js";
import VendorCallLog from "../models/vendorCallLog.model.js";
import AdminAuditLog from "../models/adminAuditLog.model.js";
import { VendorService } from "./vendor.service.js";
import { PushNotificationService } from "./push-notification.service.js";

// A vendor is considered "high performing" once it has a real rating track
// record at or above this average.
const HIGH_PERFORMER_RATING_THRESHOLD = 4.5;
// A warning "expires" from the performance-monitoring status view after this
// many days — it still exists in history, it just stops flagging the vendor
// as "Warning" on the table.
const WARNING_LOOKBACK_DAYS = 30;

export class AdminVendorRelationsService {
  private vendorService: VendorService;
  private pushNotificationService: PushNotificationService;

  constructor() {
    this.vendorService = new VendorService();
    this.pushNotificationService = new PushNotificationService();
  }

  private escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  private assertValidObjectId = (id: string, label: string) => {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException(
        `Invalid ${label}`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  private formatVendorName = (
    user: { firstName?: string; lastName?: string } | null | undefined,
  ): string =>
    user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "Unknown";

  private documentsComplete = (additionalData: Record<string, any>): boolean => {
    const documents = additionalData?.documents ?? {};
    return Boolean(
      documents.governmentId && documents.businessCertificate && documents.displayImage,
    );
  };

  private getVendorLocation = (vendor: {
    addressId?: any;
    additionalData?: Record<string, any>;
  }): string => {
    if (vendor.addressId && typeof vendor.addressId === "object" && vendor.addressId.city) {
      return vendor.addressId.city;
    }
    return vendor.additionalData?.location?.city ?? "";
  };

  // ---------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------

  getOverviewStats = async () => {
    const [activeVendors, pendingApplications, highPerformers, activeIssues] =
      await Promise.all([
        Vendor.countDocuments({ approvalStatus: "approved" }),
        Vendor.countDocuments({
          approvalStatus: "pending",
          "additionalData.onboarding.submittedAt": { $ne: null },
        }),
        Vendor.countDocuments({
          approvalStatus: "approved",
          ratingCount: { $gt: 0 },
          ratingAverage: { $gte: HIGH_PERFORMER_RATING_THRESHOLD },
        }),
        VendorIssue.countDocuments({
          status: { $in: ["open", "in_progress", "escalated"] },
        }),
      ]);

    return { activeVendors, pendingApplications, highPerformers, activeIssues };
  };

  // ---------------------------------------------------------------------
  // Paystack Split Payment — subaccount health (spec section 3.2)
  // ---------------------------------------------------------------------

  // Surfaces vendors who have complete bank details on file but no live
  // subaccount — either still pending their first attempt or stuck on a
  // stored error (e.g. an unrecognized bank name) — so admins don't have to
  // dig through server logs to find them.
  getPaystackSubaccountIssues = async () => {
    const vendors = await Vendor.find({
      paystackSubaccountCode: null,
      "payoutSettings.bankDetails.bankName": { $nin: [null, ""] },
      "payoutSettings.bankDetails.accountNumber": { $nin: [null, ""] },
    })
      .populate<{ userId: { firstName?: string; lastName?: string; email?: string } }>(
        "userId",
        "firstName lastName email",
      )
      .sort({ paystackSubaccountErrorAt: -1 })
      .lean();

    return {
      vendors: vendors.map((vendor: any) => ({
        vendorId: vendor._id,
        businessName: vendor.businessName,
        vendorName: this.formatVendorName(vendor.userId),
        email: vendor.userId?.email,
        bankName: vendor.payoutSettings?.bankDetails?.bankName,
        accountNumber: vendor.payoutSettings?.bankDetails?.accountNumber,
        error: vendor.paystackSubaccountError,
        errorAt: vendor.paystackSubaccountErrorAt,
      })),
    };
  };

  retryPaystackSubaccount = async (adminUserId: string, vendorId: string) => {
    this.assertValidObjectId(vendorId, "vendor ID");
    const result = await this.vendorService.retryPaystackSubaccountCreation(vendorId);
    return {
      vendorId,
      vendorName: this.formatVendorName(
        await User.findById(result.vendor.userId).lean(),
      ),
      paystackSubaccountCode: result.vendor.paystackSubaccountCode,
      paystackSubaccountError: result.vendor.paystackSubaccountError,
    };
  };

  // ---------------------------------------------------------------------
  // Vendor Onboarding
  // ---------------------------------------------------------------------

  getVendorApplications = async (
    filters: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { status, search, page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = {
      "additionalData.onboarding.submittedAt": { $ne: null },
    };

    if (status) {
      const normalized = status.trim().toLowerCase();
      if (!["pending", "approved", "suspended", "rejected"].includes(normalized)) {
        throw new BadRequestException(
          "Invalid status filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      query.approvalStatus = normalized;
    }

    if (search && search.trim()) {
      const regex = new RegExp(this.escapeRegex(search.trim()), "i");
      const matchingUserIds = await User.find({
        userType: "vendor",
        $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
      }).distinct("_id");
      query.$or = [{ businessName: regex }, { userId: { $in: matchingUserIds } }];
    }

    const [vendors, total] = await Promise.all([
      Vendor.find(query)
        .populate("userId", "firstName lastName email phoneNumber")
        .populate("addressId", "city state")
        .sort({ "additionalData.onboarding.submittedAt": -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      Vendor.countDocuments(query),
    ]);

    return {
      applications: vendors.map((vendor) => {
        const vendorObject = vendor.toObject() as any;
        const additionalData = vendorObject.additionalData ?? {};
        const user = vendorObject.userId;
        return {
          _id: vendorObject._id.toString(),
          vendorName: this.formatVendorName(user),
          businessName: vendorObject.businessName ?? "",
          email: user?.email ?? "",
          phone: user?.phoneNumber ?? "",
          location: this.getVendorLocation(vendorObject),
          submittedDate: additionalData?.onboarding?.submittedAt ?? null,
          documentsComplete: this.documentsComplete(additionalData),
          status: vendorObject.approvalStatus,
        };
      }),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  getVendorApplicationDetail = async (vendorId: string) => {
    this.assertValidObjectId(vendorId, "vendor ID");

    const vendor = await Vendor.findOne({
      _id: vendorId,
      "additionalData.onboarding.submittedAt": { $ne: null },
    })
      .populate("userId", "firstName lastName email phoneNumber")
      .populate("addressId", "city state");

    if (!vendor) {
      throw new NotFoundException(
        "Vendor application not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const vendorObject = vendor.toObject() as any;
    const additionalData = vendorObject.additionalData ?? {};
    const user = vendorObject.userId;

    return {
      application: {
        _id: vendorObject._id.toString(),
        vendorName: this.formatVendorName(user),
        businessName: vendorObject.businessName ?? "",
        email: user?.email ?? "",
        phone: user?.phoneNumber ?? "",
        location: this.getVendorLocation(vendorObject),
        submittedDate: additionalData?.onboarding?.submittedAt ?? null,
        documentsComplete: this.documentsComplete(additionalData),
        documents: additionalData?.documents ?? {
          governmentId: null,
          businessCertificate: null,
          displayImage: null,
        },
        status: vendorObject.approvalStatus,
        rejectionReason: vendorObject.rejectionReason ?? null,
      },
    };
  };

  approveVendorApplication = async (vendorId: string, adminUserId: string) => {
    const { vendor } = await this.vendorService.approveVendor(
      vendorId,
      adminUserId,
      "admin",
    );
    const populated = await vendor.populate("userId", "firstName lastName");
    return {
      vendor,
      vendorName: this.formatVendorName((populated as any).userId),
    };
  };

  rejectVendorApplication = async (
    vendorId: string,
    adminUserId: string,
    reason: string | undefined,
  ) => {
    const { vendor } = await this.vendorService.rejectVendor(
      vendorId,
      adminUserId,
      reason,
      "admin",
    );
    const populated = await vendor.populate("userId", "firstName lastName");
    return {
      vendor,
      vendorName: this.formatVendorName((populated as any).userId),
    };
  };

  // ---------------------------------------------------------------------
  // Performance monitoring
  // ---------------------------------------------------------------------

  getVendorPerformance = async (
    filters: {
      status?: "active" | "warning";
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { status, search, page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = { approvalStatus: "approved" };

    if (search && search.trim()) {
      const regex = new RegExp(this.escapeRegex(search.trim()), "i");
      const matchingUserIds = await User.find({
        userType: "vendor",
        $or: [{ firstName: regex }, { lastName: regex }],
      }).distinct("_id");
      query.$or = [{ businessName: regex }, { userId: { $in: matchingUserIds } }];
    }

    // Vendor count is small enough for admin tooling that we fetch the full
    // approved set and paginate after merging in computed (non-indexable)
    // fields like warning status, rather than push a derived filter into Mongo.
    const vendors = await Vendor.find(query)
      .populate("userId", "firstName lastName email phoneNumber")
      .populate("addressId", "city state")
      .sort({ ratingScore: -1 })
      .limit(500);

    const vendorIds = vendors.map((vendor) => vendor._id);
    const warningCutoff = new Date(
      Date.now() - WARNING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    const [orderCounts, refundCounts, delayCounts, recentWarnings] =
      await Promise.all([
        Order.aggregate<{ _id: any; count: number }>([
          { $match: { vendorId: { $in: vendorIds } } },
          { $group: { _id: "$vendorId", count: { $sum: 1 } } },
        ]),
        RefundRequest.aggregate<{ _id: any; count: number }>([
          { $match: { vendorId: { $in: vendorIds } } },
          { $group: { _id: "$vendorId", count: { $sum: 1 } } },
        ]),
        VendorIssue.aggregate<{ _id: any; count: number }>([
          {
            $match: {
              vendorId: { $in: vendorIds },
              category: "delivery_delay",
            },
          },
          { $group: { _id: "$vendorId", count: { $sum: 1 } } },
        ]),
        VendorWarning.aggregate<{ _id: any; count: number }>([
          {
            $match: {
              vendorId: { $in: vendorIds },
              createdAt: { $gte: warningCutoff },
            },
          },
          { $group: { _id: "$vendorId", count: { $sum: 1 } } },
        ]),
      ]);

    const toMap = (rows: { _id: any; count: number }[]) =>
      new Map(rows.map((row) => [row._id.toString(), row.count]));
    const orderCountMap = toMap(orderCounts);
    const refundCountMap = toMap(refundCounts);
    const delayCountMap = toMap(delayCounts);
    const warningCountMap = toMap(recentWarnings);

    const rows = vendors.map((vendor) => {
      const vendorObject = vendor.toObject() as any;
      const id = vendorObject._id.toString();
      const hasRecentWarning = (warningCountMap.get(id) ?? 0) > 0;
      return {
        _id: id,
        vendorName: this.formatVendorName(vendorObject.userId),
        businessName: vendorObject.businessName ?? "",
        status: hasRecentWarning ? "warning" : "active",
        rating: vendorObject.ratingAverage ?? 0,
        orders: orderCountMap.get(id) ?? 0,
        delays: delayCountMap.get(id) ?? 0,
        refunds: refundCountMap.get(id) ?? 0,
      };
    });

    const filteredRows = status ? rows.filter((row) => row.status === status) : rows;
    const total = filteredRows.length;
    const paginatedRows = filteredRows.slice(
      (safePage - 1) * safeLimit,
      (safePage - 1) * safeLimit + safeLimit,
    );

    return {
      vendors: paginatedRows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  getVendorPerformanceDetail = async (vendorId: string) => {
    this.assertValidObjectId(vendorId, "vendor ID");

    const vendor = await Vendor.findById(vendorId)
      .populate("userId", "firstName lastName email phoneNumber")
      .populate("addressId", "city state");

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const warningCutoff = new Date(
      Date.now() - WARNING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    const [totalOrders, refunds, delays, hasRecentWarning] = await Promise.all([
      Order.countDocuments({ vendorId: vendor._id }),
      RefundRequest.countDocuments({ vendorId: vendor._id }),
      VendorIssue.countDocuments({
        vendorId: vendor._id,
        category: "delivery_delay",
      }),
      VendorWarning.exists({
        vendorId: vendor._id,
        createdAt: { $gte: warningCutoff },
      }),
    ]);

    const vendorObject = vendor.toObject() as any;
    const user = vendorObject.userId;

    return {
      performance: {
        _id: vendorObject._id.toString(),
        vendorName: this.formatVendorName(user),
        businessName: vendorObject.businessName ?? "",
        status: hasRecentWarning ? "warning" : "active",
        rating: vendorObject.ratingAverage ?? 0,
        totalOrders,
        delays,
        refunds,
        joinDate: vendorObject._id.getTimestamp(),
        contact: {
          email: user?.email ?? "",
          phone: user?.phoneNumber ?? "",
          location: this.getVendorLocation(vendorObject),
        },
      },
    };
  };

  sendWarning = async (
    vendorId: string,
    adminUserId: string,
    message: string,
  ) => {
    this.assertValidObjectId(vendorId, "vendor ID");

    const vendor = await Vendor.findById(vendorId).populate(
      "userId",
      "firstName lastName",
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const warning = await VendorWarning.create({
      vendorId: vendor._id,
      message,
      issuedBy: adminUserId,
    });

    if (vendor.pushNotificationsEnabled && vendor.expoTokens?.length) {
      this.pushNotificationService
        .sendToTokens(vendor.expoTokens, {
          title: "Formal warning from TheOtherWife",
          body: message,
        })
        .catch((error) => {
          console.error("Failed to push vendor warning notification:", error);
        });
    }

    return {
      warning,
      vendorName: this.formatVendorName((vendor as any).userId),
    };
  };

  // ---------------------------------------------------------------------
  // Issue resolution
  // ---------------------------------------------------------------------

  getIssues = async (
    filters: {
      status?: string;
      priority?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { status, priority, page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = {};

    if (status) {
      if (!["open", "in_progress", "resolved", "escalated"].includes(status)) {
        throw new BadRequestException(
          "Invalid status filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      query.status = status;
    }

    if (priority) {
      if (!["low", "medium", "high", "critical"].includes(priority)) {
        throw new BadRequestException(
          "Invalid priority filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      query.priority = priority;
    }

    const [issues, total] = await Promise.all([
      VendorIssue.find(query)
        .populate({
          path: "vendorId",
          select: "businessName userId",
          populate: { path: "userId", select: "firstName lastName" },
        })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      VendorIssue.countDocuments(query),
    ]);

    return {
      issues: issues.map((issue) => this.formatIssue(issue)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  private formatIssue = (issue: any) => {
    const issueObject = issue.toObject ? issue.toObject() : issue;
    const vendor = issueObject.vendorId;
    return {
      _id: issueObject._id.toString(),
      vendorId: vendor?._id?.toString?.() ?? vendor?.toString?.() ?? null,
      vendorName: this.formatVendorName(vendor?.userId),
      businessName: vendor?.businessName ?? "",
      category: issueObject.category,
      title: issueObject.title,
      description: issueObject.description,
      priority: issueObject.priority,
      status: issueObject.status,
      resolutionNotes: issueObject.resolutionNotes ?? null,
      submittedDate: issueObject.createdAt,
      resolvedAt: issueObject.resolvedAt ?? null,
      escalatedAt: issueObject.escalatedAt ?? null,
    };
  };

  getIssueDetail = async (issueId: string) => {
    this.assertValidObjectId(issueId, "issue ID");

    const issue = await VendorIssue.findById(issueId).populate({
      path: "vendorId",
      select: "businessName userId",
      populate: { path: "userId", select: "firstName lastName" },
    });

    if (!issue) {
      throw new NotFoundException(
        "Vendor issue not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { issue: this.formatIssue(issue) };
  };

  createIssue = async (
    adminUserId: string,
    body: {
      vendorId: string;
      category: VendorIssueCategory;
      title: string;
      description: string;
      priority?: VendorIssuePriority;
    },
  ) => {
    this.assertValidObjectId(body.vendorId, "vendor ID");

    const vendor = await Vendor.findById(body.vendorId);
    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const issue = await VendorIssue.create({
      vendorId: vendor._id,
      category: body.category,
      title: body.title,
      description: body.description,
      priority: body.priority ?? "medium",
      createdBy: adminUserId,
    });

    const populatedIssue = await issue.populate({
      path: "vendorId",
      select: "businessName userId",
      populate: { path: "userId", select: "firstName lastName" },
    });

    return { issue: this.formatIssue(populatedIssue) };
  };

  resolveIssue = async (
    issueId: string,
    adminUserId: string,
    resolutionNotes: string,
  ) => {
    this.assertValidObjectId(issueId, "issue ID");

    const issue = await VendorIssue.findByIdAndUpdate(
      issueId,
      {
        $set: {
          status: "resolved",
          resolutionNotes,
          resolvedBy: adminUserId,
          resolvedAt: new Date(),
        },
      },
      { new: true },
    ).populate({
      path: "vendorId",
      select: "businessName userId",
      populate: { path: "userId", select: "firstName lastName" },
    });

    if (!issue) {
      throw new NotFoundException(
        "Vendor issue not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { issue: this.formatIssue(issue) };
  };

  escalateIssue = async (issueId: string) => {
    this.assertValidObjectId(issueId, "issue ID");

    const issue = await VendorIssue.findByIdAndUpdate(
      issueId,
      { $set: { status: "escalated", escalatedAt: new Date() } },
      { new: true },
    ).populate({
      path: "vendorId",
      select: "businessName userId",
      populate: { path: "userId", select: "firstName lastName" },
    });

    if (!issue) {
      throw new NotFoundException(
        "Vendor issue not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { issue: this.formatIssue(issue) };
  };

  // ---------------------------------------------------------------------
  // Communications
  // ---------------------------------------------------------------------

  getCommunicationsSummary = async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [unreadMessages, callLogsThisMonth] = await Promise.all([
      VendorMessage.countDocuments({ senderType: "vendor", isRead: false }),
      VendorCallLog.countDocuments({ calledAt: { $gte: startOfMonth } }),
    ]);

    return { unreadMessages, callLogsThisMonth };
  };

  // Returns the latest inbound (vendor-sent) message per vendor, newest
  // first — an inbox view, not a full thread history. Marks all vendor
  // messages as read as a side effect, mirroring the unread-count badge
  // clearing once the inbox is opened.
  getVendorMessages = async (limit = 20) => {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const latestPerVendor = await VendorMessage.aggregate<{
      _id: any;
      message: string;
      createdAt: Date;
    }>([
      { $match: { senderType: "vendor" } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$vendorId",
          message: { $first: "$message" },
          createdAt: { $first: "$createdAt" },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: safeLimit },
    ]);

    const vendorIds = latestPerVendor.map((entry) => entry._id);
    const vendors = await Vendor.find({ _id: { $in: vendorIds } }).populate(
      "userId",
      "firstName lastName",
    );
    const vendorById = new Map(
      vendors.map((vendor) => [vendor._id.toString(), vendor]),
    );

    await VendorMessage.updateMany(
      { senderType: "vendor", isRead: false },
      { $set: { isRead: true } },
    );

    return {
      messages: latestPerVendor.map((entry) => {
        const vendor = vendorById.get(entry._id.toString());
        return {
          vendorId: entry._id.toString(),
          vendorName: this.formatVendorName((vendor as any)?.userId),
          message: entry.message,
          createdAt: entry.createdAt,
        };
      }),
    };
  };

  sendMessageToVendor = async (
    adminUserId: string,
    vendorId: string,
    message: string,
  ) => {
    this.assertValidObjectId(vendorId, "vendor ID");

    const vendor = await Vendor.findById(vendorId).populate(
      "userId",
      "firstName lastName",
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const created = await VendorMessage.create({
      vendorId: vendor._id,
      senderType: "admin",
      senderId: adminUserId,
      message,
      isRead: true,
    });

    if (vendor.pushNotificationsEnabled && vendor.expoTokens?.length) {
      this.pushNotificationService
        .sendToTokens(vendor.expoTokens, {
          title: "New message from TheOtherWife",
          body: message,
        })
        .catch((error) => {
          console.error("Failed to push vendor message notification:", error);
        });
    }

    return {
      message: created,
      vendorName: this.formatVendorName((vendor as any).userId),
    };
  };

  getCallLogs = async (limit = 20) => {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const logs = await VendorCallLog.find()
      .populate({
        path: "vendorId",
        select: "userId",
        populate: { path: "userId", select: "firstName lastName phoneNumber" },
      })
      .sort({ calledAt: -1 })
      .limit(safeLimit);

    return {
      callLogs: logs.map((log) => {
        const logObject = log.toObject() as any;
        const vendor = logObject.vendorId;
        return {
          _id: logObject._id.toString(),
          vendorId: vendor?._id?.toString?.() ?? null,
          vendorName: this.formatVendorName(vendor?.userId),
          phone: vendor?.userId?.phoneNumber ?? "",
          durationSeconds: logObject.durationSeconds,
          notes: logObject.notes ?? null,
          calledAt: logObject.calledAt,
        };
      }),
    };
  };

  logCall = async (
    adminUserId: string,
    vendorId: string,
    durationSeconds: number,
    notes: string | undefined,
  ) => {
    this.assertValidObjectId(vendorId, "vendor ID");

    const vendor = await Vendor.findById(vendorId).populate(
      "userId",
      "firstName lastName",
    );

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const callLog = await VendorCallLog.create({
      vendorId: vendor._id,
      adminUserId,
      durationSeconds,
      notes,
      calledAt: new Date(),
    });

    return {
      callLog,
      vendorName: this.formatVendorName((vendor as any).userId),
    };
  };

  // ---------------------------------------------------------------------
  // Recent activity
  // ---------------------------------------------------------------------

  getRecentActivity = async (limit = 10) => {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const logs = await AdminAuditLog.find({
      action: { $regex: "^vendor_relations\\." },
    })
      .sort({ createdAt: -1 })
      .limit(safeLimit);

    return {
      activity: logs.map((log) => ({
        description: (log.metadata as Record<string, unknown> | undefined)
          ?.description as string | undefined ?? log.action,
        createdAt: log.createdAt,
      })),
    };
  };
}
