/** @format */

import { Router } from "express";
import { SupportTicketController } from "../controllers/support-ticket.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { replyToSupportTicketSchema } from "../zod-schema/support-ticket.schema.js";

/**
 * @swagger
 * /api/v1/vendor/support-tickets:
 *   get:
 *     summary: List support tickets tied to the current vendor
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
 * /api/v1/vendor/support-tickets/{id}:
 *   get:
 *     summary: Get a support ticket tied to the current vendor
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
 * /api/v1/vendor/support-tickets/{id}/reply:
 *   post:
 *     summary: Reply to a support ticket tied to the current vendor
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

class VendorSupportTicketRouter {
  router: Router;
  controller: SupportTicketController;

  constructor() {
    this.router = Router();
    this.controller = new SupportTicketController();
    this.router.use(authMiddleware, roleGuardMiddleware(["vendor"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getVendorTickets);
    this.router.get("/:id", this.controller.getVendorTicketById);
    this.router.post(
      "/:id/reply",
      zodValidation(replyToSupportTicketSchema),
      this.controller.replyAsVendor,
    );
  }
}

export const vendorSupportTicketRouter = new VendorSupportTicketRouter()
  .router;
