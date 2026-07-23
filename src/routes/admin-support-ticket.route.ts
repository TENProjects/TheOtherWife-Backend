/** @format */

import { Router } from "express";
import { SupportTicketController } from "../controllers/support-ticket.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  replyToSupportTicketSchema,
  updateSupportTicketStatusSchema,
  addSupportTicketNoteSchema,
} from "../zod-schema/support-ticket.schema.js";

/**
 * @swagger
 * /api/v1/admin/support-tickets:
 *   get:
 *     summary: List all support tickets
 *     tags: [Admin - Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, in_progress, resolved, closed] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [low, medium, high, critical] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches against subject or ticketNumber
 *     responses:
 *       "200":
 *         description: Support tickets fetched successfully
 *
 * /api/v1/admin/support-tickets/{id}:
 *   get:
 *     summary: Get full support ticket detail, including internal notes
 *     tags: [Admin - Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Support ticket fetched successfully
 *       "404":
 *         description: Ticket not found
 *
 * /api/v1/admin/support-tickets/{id}/reply:
 *   post:
 *     summary: Reply to a support ticket as admin
 *     tags: [Admin - Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *     responses:
 *       "200":
 *         description: Reply sent successfully
 *       "400":
 *         description: Ticket is closed
 *
 * /api/v1/admin/support-tickets/{id}/status:
 *   patch:
 *     summary: Update a support ticket's status and/or priority
 *     tags: [Admin - Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [open, in_progress, resolved, closed] }
 *               priority: { type: string, enum: [low, medium, high, critical] }
 *     responses:
 *       "200":
 *         description: Ticket updated successfully
 *
 * /api/v1/admin/support-tickets/{id}/notes:
 *   post:
 *     summary: Add a staff-only internal note to a support ticket
 *     tags: [Admin - Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note: { type: string }
 *     responses:
 *       "200":
 *         description: Internal note added successfully
 */

class AdminSupportTicketRouter {
  router: Router;
  controller: SupportTicketController;

  constructor() {
    this.router = Router();
    this.controller = new SupportTicketController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager", "support_agent"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getAdminTickets);
    this.router.get("/:id", this.controller.getAdminTicketById);
    this.router.post(
      "/:id/reply",
      zodValidation(replyToSupportTicketSchema),
      this.controller.replyAsAdmin,
    );
    this.router.patch(
      "/:id/status",
      zodValidation(updateSupportTicketStatusSchema),
      this.controller.updateStatus,
    );
    this.router.post(
      "/:id/notes",
      zodValidation(addSupportTicketNoteSchema),
      this.controller.addNote,
    );
  }
}

export const adminSupportTicketRouter = new AdminSupportTicketRouter().router;
