/** @format */

import { Router } from "express";
import { SupportTicketController } from "../controllers/support-ticket.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  createSupportTicketSchema,
  replyToSupportTicketSchema,
} from "../zod-schema/support-ticket.schema.js";

/**
 * @swagger
 * /api/v1/support-tickets:
 *   post:
 *     summary: Create a new support ticket
 *     tags: [Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               subject: { type: string }
 *               category:
 *                 type: string
 *                 enum: [order_issue, payment_issue, delivery_issue, food_quality, account_issue, other]
 *               message: { type: string }
 *               orderId:
 *                 type: string
 *                 description: If provided, the ticket's vendorId is derived from this order
 *     responses:
 *       "201":
 *         description: Support ticket created successfully
 *
 * /api/v1/support-tickets/me:
 *   get:
 *     summary: List the current customer's support tickets
 *     tags: [Support Tickets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       "200":
 *         description: Support tickets fetched successfully
 *
 * /api/v1/support-tickets/me/{id}:
 *   get:
 *     summary: Get a support ticket owned by the current customer
 *     tags: [Support Tickets]
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
 * /api/v1/support-tickets/me/{id}/reply:
 *   post:
 *     summary: Reply to the current customer's own support ticket
 *     tags: [Support Tickets]
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
 */

class SupportTicketRouter {
  router: Router;
  controller: SupportTicketController;

  constructor() {
    this.router = Router();
    this.controller = new SupportTicketController();
    this.router.use(authMiddleware, roleGuardMiddleware(["customer"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/",
      zodValidation(createSupportTicketSchema),
      this.controller.create,
    );
    this.router.get("/me", this.controller.getMyTickets);
    this.router.get("/me/:id", this.controller.getMyTicketById);
    this.router.post(
      "/me/:id/reply",
      zodValidation(replyToSupportTicketSchema),
      this.controller.replyAsCustomer,
    );
  }
}

export const supportTicketRouter = new SupportTicketRouter().router;
