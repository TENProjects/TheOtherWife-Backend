/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { SupportTicketService } from "../services/support-ticket.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

type IdParam = { id: string };

export class SupportTicketController {
  private supportTicketService: SupportTicketService;

  constructor() {
    this.supportTicketService = new SupportTicketService();
  }

  // ── Customer ─────────────────────────────────────────────────────────

  create = handleAsyncControl(async (req: Request, res: Response) => {
    const customerId = req.user?._id as unknown as string;
    const ticket = await this.supportTicketService.createTicket(
      customerId,
      req.body,
    );

    return res.status(HttpStatus.CREATED).json({
      status: "ok",
      message: "Support ticket created successfully",
      data: { ticket },
    } as ApiResponse);
  });

  getMyTickets = handleAsyncControl(async (req: Request, res: Response) => {
    const customerId = req.user?._id as unknown as string;
    const { page, limit } = req.query;
    const result = await this.supportTicketService.getMyTickets(customerId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Support tickets fetched successfully",
      data: result,
    } as ApiResponse);
  });

  getMyTicketById = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const customerId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.getMyTicketById(
        customerId,
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Support ticket fetched successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  replyAsCustomer = handleAsyncControl(
    async (req: Request<IdParam, {}, { message: string }>, res: Response) => {
      const customerId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.replyAsCustomer(
        customerId,
        req.params.id,
        req.body.message,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Reply sent successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  // ── Vendor ───────────────────────────────────────────────────────────

  getVendorTickets = handleAsyncControl(async (req: Request, res: Response) => {
    const vendorUserId = req.user?._id as unknown as string;
    const { page, limit } = req.query;
    const result = await this.supportTicketService.getVendorTickets(
      vendorUserId,
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      },
    );

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Support tickets fetched successfully",
      data: result,
    } as ApiResponse);
  });

  getVendorTicketById = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const vendorUserId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.getVendorTicketById(
        vendorUserId,
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Support ticket fetched successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  replyAsVendor = handleAsyncControl(
    async (req: Request<IdParam, {}, { message: string }>, res: Response) => {
      const vendorUserId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.replyAsVendor(
        vendorUserId,
        req.params.id,
        req.body.message,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Reply sent successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  // ── Admin ────────────────────────────────────────────────────────────

  getAdminTickets = handleAsyncControl(async (req: Request, res: Response) => {
    const { page, limit, status, priority, category, search } = req.query;
    const result = await this.supportTicketService.getAdminTickets({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string | undefined,
      priority: priority as string | undefined,
      category: category as string | undefined,
      search: search as string | undefined,
    });

    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Support tickets fetched successfully",
      data: result,
    } as ApiResponse);
  });

  getAdminTicketById = handleAsyncControl(
    async (req: Request<IdParam>, res: Response) => {
      const ticket = await this.supportTicketService.getAdminTicketById(
        req.params.id,
      );

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Support ticket fetched successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  replyAsAdmin = handleAsyncControl(
    async (req: Request<IdParam, {}, { message: string }>, res: Response) => {
      const adminUserId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.replyAsAdmin(
        adminUserId,
        req.params.id,
        req.body.message,
      );

      logAdminAction({
        adminUserId,
        action: "support_ticket.reply",
        targetType: "SupportTicket",
        targetId: req.params.id,
        metadata: { message: req.body.message },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Reply sent successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  updateStatus = handleAsyncControl(
    async (
      req: Request<IdParam, {}, { status?: string; priority?: string }>,
      res: Response,
    ) => {
      const adminUserId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.updateTicketStatus(
        adminUserId,
        req.params.id,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "support_ticket.status_update",
        targetType: "SupportTicket",
        targetId: req.params.id,
        metadata: req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Ticket updated successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );

  addNote = handleAsyncControl(
    async (req: Request<IdParam, {}, { note: string }>, res: Response) => {
      const adminUserId = req.user?._id as unknown as string;
      const ticket = await this.supportTicketService.addInternalNote(
        adminUserId,
        req.params.id,
        req.body.note,
      );

      logAdminAction({
        adminUserId,
        action: "support_ticket.add_note",
        targetType: "SupportTicket",
        targetId: req.params.id,
        metadata: { note: req.body.note },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Internal note added successfully",
        data: { ticket },
      } as ApiResponse);
    },
  );
}
