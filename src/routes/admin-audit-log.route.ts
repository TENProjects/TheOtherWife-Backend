/** @format */

import { Router } from "express";
import { AdminAuditLogController } from "../controllers/admin-audit-log.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/audit-logs:
 *   get:
 *     summary: List admin audit log entries (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: action
 *         required: false
 *         schema:
 *           type: string
 *         description: >-
 *           Filter by action, e.g. "vendor.approve", "vendor.reject",
 *           "vendor.suspend", "vendor.inspection_status_update",
 *           "user.status_update", "admin.create", "payout.update",
 *           "customer.group_assign", "customer.notes_update",
 *           "customer.reset_password", "financials.gateway_update",
 *           "financials.commission_update", "financials.tax_update",
 *           "financials.system_settings_update", "refund.approve", "refund.reject",
 *           "blog.post_create", "blog.post_update", "blog.post_toggle_visibility",
 *           "blog.post_archive", "blog.post_delete"
 *       - in: query
 *         name: targetType
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by target resource type, e.g. "Vendor", "User", "VendorPayoutRequest"
 *       - in: query
 *         name: adminUserId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by the admin who performed the action
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *           description: Max 100, default 50
 *     responses:
 *       "200":
 *         description: Audit logs fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         logs:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/AdminAuditLog"
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 *       "401":
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/401"
 *       "403":
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/403"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

class AdminAuditLogRouter {
  private adminAuditLogController: AdminAuditLogController;
  router: Router;

  constructor() {
    this.adminAuditLogController = new AdminAuditLogController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.adminAuditLogController.getAuditLogs);
  }
}

export const adminAuditLogRouter = new AdminAuditLogRouter().router;
