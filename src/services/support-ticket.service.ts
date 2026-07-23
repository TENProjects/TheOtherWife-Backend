/** @format */

import SupportTicket, {
  SupportTicketDocument,
} from "../models/supportTicket.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import Vendor from "../models/vendor.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { nextSequence } from "../util/counter.util.js";
import { NotificationService } from "./notification.service.js";

type Pagination = { page?: number; limit?: number };

const paginate = ({ page = 1, limit = 20 }: Pagination) => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};

const buildPaginationResult = (
  safePage: number,
  safeLimit: number,
  total: number,
) => ({
  page: safePage,
  limit: safeLimit,
  total,
  totalPages: Math.max(Math.ceil(total / safeLimit), 1),
});

// Strips internalNotes before returning a ticket to a customer/vendor — that
// field is staff-only and must never leak outside admin-facing responses.
const omitInternalNotes = (ticket: SupportTicketDocument) => {
  const obj = ticket.toObject();
  const { internalNotes, ...rest } = obj as any;
  return rest;
};

export class SupportTicketService {
  private notificationService = new NotificationService();

  // Notifies whichever parties didn't just send this reply — additive,
  // fire-and-forget-adjacent (awaited, but errors here shouldn't be
  // possible in normal operation since it's just a DB insert; if it ever
  // throws, that's a real bug worth surfacing rather than swallowing).
  private notifyOnReply = async (
    ticket: SupportTicketDocument,
    excludeSenderType: "customer" | "vendor" | "admin",
  ) => {
    const notifications: Promise<unknown>[] = [];

    if (excludeSenderType !== "customer") {
      notifications.push(
        this.notificationService.create({
          recipientUserId: ticket.customerId.toString(),
          recipientType: "customer",
          type: "support_ticket",
          title: `New reply on ticket ${ticket.ticketNumber}`,
          body: ticket.subject,
          relatedEntityType: "SupportTicket",
          relatedEntityId: (ticket._id as any).toString(),
        }),
      );
    }

    if (excludeSenderType !== "vendor" && ticket.vendorId) {
      const vendor = await Vendor.findById(ticket.vendorId).select("userId");
      if (vendor) {
        notifications.push(
          this.notificationService.create({
            recipientUserId: vendor.userId.toString(),
            recipientType: "vendor",
            type: "support_ticket",
            title: `New reply on ticket ${ticket.ticketNumber}`,
            body: ticket.subject,
            relatedEntityType: "SupportTicket",
            relatedEntityId: (ticket._id as any).toString(),
          }),
        );
      }
    }

    await Promise.all(notifications);
  };

  private getVendorByUserId = async (userId: string) => {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return vendor;
  };

  private assertNotClosed = (ticket: SupportTicketDocument) => {
    if (ticket.status === "closed") {
      throw new BadRequestException(
        "This ticket is closed and can no longer receive replies",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  // ── Customer-facing ──────────────────────────────────────────────────

  createTicket = async (
    customerId: string,
    body: {
      subject: string;
      category?: string;
      message: string;
      orderId?: string;
    },
  ) => {
    const customer = await User.findById(customerId);
    if (!customer) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }

    let vendorId: string | undefined;
    if (body.orderId) {
      const order = await Order.findOne({
        _id: body.orderId,
        customerId,
      });
      if (!order) {
        throw new NotFoundException(
          "Order not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }
      vendorId = order.vendorId.toString();
    }

    const seq = await nextSequence("supportTicket");
    const ticketNumber = `T${String(seq).padStart(3, "0")}`;

    const ticket = await SupportTicket.create({
      ticketNumber,
      customerId,
      vendorId,
      orderId: body.orderId,
      subject: body.subject,
      category: body.category ?? "other",
      messages: [
        {
          senderType: "customer",
          senderId: customerId,
          senderName: `${customer.firstName} ${customer.lastName}`.trim(),
          message: body.message,
          createdAt: new Date(),
        },
      ],
    });

    return omitInternalNotes(ticket);
  };

  getMyTickets = async (customerId: string, pagination: Pagination) => {
    const { safeLimit, safePage, skip } = paginate(pagination);

    const [tickets, total] = await Promise.all([
      SupportTicket.find({ customerId })
        .select("-internalNotes")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      SupportTicket.countDocuments({ customerId }),
    ]);

    return {
      tickets,
      pagination: buildPaginationResult(safePage, safeLimit, total),
    };
  };

  getMyTicketById = async (customerId: string, ticketId: string) => {
    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      customerId,
    }).select("-internalNotes");

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return ticket;
  };

  replyAsCustomer = async (
    customerId: string,
    ticketId: string,
    message: string,
  ) => {
    const [ticket, customer] = await Promise.all([
      SupportTicket.findOne({ _id: ticketId, customerId }),
      User.findById(customerId),
    ]);

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    if (!customer) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }
    this.assertNotClosed(ticket);

    ticket.messages.push({
      senderType: "customer",
      senderId: customer._id as any,
      senderName: `${customer.firstName} ${customer.lastName}`.trim(),
      message,
      createdAt: new Date(),
    });
    await ticket.save();
    await this.notifyOnReply(ticket, "customer");

    return omitInternalNotes(ticket);
  };

  // ── Vendor-facing ────────────────────────────────────────────────────

  getVendorTickets = async (vendorUserId: string, pagination: Pagination) => {
    const vendor = await this.getVendorByUserId(vendorUserId);
    const { safeLimit, safePage, skip } = paginate(pagination);

    const [tickets, total] = await Promise.all([
      SupportTicket.find({ vendorId: vendor._id })
        .select("-internalNotes")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      SupportTicket.countDocuments({ vendorId: vendor._id }),
    ]);

    return {
      tickets,
      pagination: buildPaginationResult(safePage, safeLimit, total),
    };
  };

  getVendorTicketById = async (vendorUserId: string, ticketId: string) => {
    const vendor = await this.getVendorByUserId(vendorUserId);
    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      vendorId: vendor._id,
    }).select("-internalNotes");

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return ticket;
  };

  replyAsVendor = async (
    vendorUserId: string,
    ticketId: string,
    message: string,
  ) => {
    const vendor = await this.getVendorByUserId(vendorUserId);
    const ticket = await SupportTicket.findOne({
      _id: ticketId,
      vendorId: vendor._id,
    });

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    this.assertNotClosed(ticket);

    ticket.messages.push({
      senderType: "vendor",
      senderId: vendorUserId as any,
      senderName: vendor.businessName || "Vendor",
      message,
      createdAt: new Date(),
    });
    await ticket.save();
    await this.notifyOnReply(ticket, "vendor");

    return omitInternalNotes(ticket);
  };

  // ── Admin-facing ─────────────────────────────────────────────────────

  getAdminTickets = async (
    filters: Pagination & {
      status?: string;
      priority?: string;
      category?: string;
      search?: string;
    },
  ) => {
    const { safeLimit, safePage, skip } = paginate(filters);

    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.category) query.category = filters.category;
    if (filters.search) {
      query.$or = [
        { subject: { $regex: filters.search, $options: "i" } },
        { ticketNumber: { $regex: filters.search, $options: "i" } },
      ];
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(query)
        .select("-internalNotes")
        .populate("customerId", "firstName lastName email")
        .populate("vendorId", "businessName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      SupportTicket.countDocuments(query),
    ]);

    return {
      tickets,
      pagination: buildPaginationResult(safePage, safeLimit, total),
    };
  };

  getAdminTicketById = async (ticketId: string) => {
    const ticket = await SupportTicket.findById(ticketId)
      .populate("customerId", "firstName lastName email phoneNumber")
      .populate("vendorId", "businessName")
      .populate("internalNotes.adminUserId", "firstName lastName");

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return ticket;
  };

  replyAsAdmin = async (
    adminUserId: string,
    ticketId: string,
    message: string,
  ) => {
    const [ticket, admin] = await Promise.all([
      SupportTicket.findById(ticketId),
      User.findById(adminUserId),
    ]);

    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    if (!admin) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.AUTH_USER_NOT_FOUND,
      );
    }
    this.assertNotClosed(ticket);

    ticket.messages.push({
      senderType: "admin",
      senderId: admin._id as any,
      senderName: `${admin.firstName} ${admin.lastName}`.trim(),
      message,
      createdAt: new Date(),
    });
    await ticket.save();
    await this.notifyOnReply(ticket, "admin");

    return ticket;
  };

  updateTicketStatus = async (
    adminUserId: string,
    ticketId: string,
    updates: { status?: string; priority?: string },
  ) => {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (updates.status) {
      ticket.status = updates.status as SupportTicketDocument["status"];
      if (updates.status === "resolved" || updates.status === "closed") {
        ticket.resolvedBy = adminUserId as any;
        ticket.resolvedAt = new Date();
      }
    }
    if (updates.priority) {
      ticket.priority = updates.priority as SupportTicketDocument["priority"];
    }

    await ticket.save();
    return ticket;
  };

  addInternalNote = async (
    adminUserId: string,
    ticketId: string,
    note: string,
  ) => {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException(
        "Ticket not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    ticket.internalNotes.push({
      adminUserId: adminUserId as any,
      note,
      createdAt: new Date(),
    });
    await ticket.save();

    return ticket;
  };
}
