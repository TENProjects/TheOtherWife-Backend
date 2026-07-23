/** @format */

import { Router } from "express";
import { AdminVendorRelationsController } from "../controllers/admin-vendor-relations.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import {
  createVendorIssueSchema,
  logVendorCallSchema,
  rejectVendorApplicationSchema,
  resolveVendorIssueSchema,
  sendVendorMessageSchema,
  sendVendorWarningSchema,
} from "../zod-schema/vendor-relations.schema.js";

/**
 * @swagger
 * /api/v1/admin/vendor-relations/overview:
 *   get:
 *     summary: Get Vendor Relations overview stats (admin)
 *     description: >-
 *       Backs the stat cards shown across all Vendor Relations tabs:
 *       Active Vendors, Pending Applications, High Performers, Active Issues.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Vendor relations overview fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/paystack-subaccounts:
 *   get:
 *     summary: List vendors with unresolved Paystack subaccount issues (admin)
 *     description: >-
 *       Vendors who have complete bank details on file but no live Paystack
 *       subaccount yet (Financial & Commission Spec v1.0, section 3.2) —
 *       either not yet attempted or stuck on a stored error (e.g. an
 *       unrecognized bank name). These vendors still settle via the manual
 *       VendorPayoutRequest flow until this is resolved.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Vendors with unresolved Paystack subaccount issues fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/paystack-subaccounts/{vendorId}/retry:
 *   post:
 *     summary: Manually retry Paystack subaccount creation for a vendor (admin)
 *     description: >-
 *       Useful after correcting a bad bank name/account number. Never throws
 *       on repeated failure — check the returned `paystackSubaccountError`
 *       field if `paystackSubaccountCode` is still absent.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Retry attempted (check response body for success/failure)
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/applications:
 *   get:
 *     summary: List submitted vendor applications (admin)
 *     description: >-
 *       Vendor Onboarding tab table. Only includes vendors that have
 *       actually submitted onboarding (additionalData.onboarding.submittedAt
 *       is set) — unsubmitted in-progress signups are excluded.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           $ref: "#/components/schemas/VendorApprovalStatus"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Matches business name or the vendor's name/email
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Vendor applications fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/applications/{vendorId}:
 *   get:
 *     summary: Get a vendor application's details (admin)
 *     description: Powers the "Vendor Application Details" modal.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor application fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/applications/{vendorId}/approve:
 *   patch:
 *     summary: Approve a vendor application (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor application approved successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/applications/{vendorId}/reject:
 *   patch:
 *     summary: Reject a vendor application (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       "200":
 *         description: Vendor application rejected successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/performance:
 *   get:
 *     summary: List approved vendors with performance metrics (admin)
 *     description: >-
 *       Performance Monitoring tab table. `status` is computed: "warning"
 *       when the vendor has received a VendorWarning in the last 30 days,
 *       otherwise "active". `delays` counts VendorIssue documents in the
 *       delivery_delay category; `refunds` counts RefundRequest documents.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, warning]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Vendor performance fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/performance/{vendorId}:
 *   get:
 *     summary: Get a vendor's performance detail (admin)
 *     description: Powers the "Vendor Performance Details" modal.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor performance detail fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/performance/{vendorId}/warning:
 *   post:
 *     summary: Send a formal warning to a vendor (admin)
 *     description: >-
 *       Creates a VendorWarning record (drives the "warning" performance
 *       status for 30 days) and pushes a notification to the vendor's
 *       registered devices, if any.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       "201":
 *         description: Warning sent to vendor successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/issues:
 *   get:
 *     summary: List vendor-related issues (admin)
 *     description: Issue Resolution tab list.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, resolved, escalated]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Vendor issues fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   post:
 *     summary: Log a new vendor-related issue (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, category, title, description]
 *             properties:
 *               vendorId: { type: string }
 *               category:
 *                 type: string
 *                 enum: [delivery_delay, food_quality, policy_violation, customer_complaint, other]
 *               title: { type: string, maxLength: 200 }
 *               description: { type: string, maxLength: 2000 }
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *                 default: medium
 *     responses:
 *       "201":
 *         description: Vendor issue logged successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/issues/{issueId}:
 *   get:
 *     summary: Get a vendor issue's details (admin)
 *     description: Powers the "Issue Details" modal.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor issue fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/issues/{issueId}/resolve:
 *   patch:
 *     summary: Mark a vendor issue as resolved (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolutionNotes]
 *             properties:
 *               resolutionNotes:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       "200":
 *         description: Vendor issue resolved successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/issues/{issueId}/escalate:
 *   patch:
 *     summary: Escalate a vendor issue (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: issueId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor issue escalated successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/communications/summary:
 *   get:
 *     summary: Get vendor communications summary (admin)
 *     description: >-
 *       Communications tab cards: unread in-app messages from vendors, and
 *       recorded call count for the current calendar month.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Vendor communications summary fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/communications/messages:
 *   get:
 *     summary: List recent inbound vendor messages (admin)
 *     description: >-
 *       Powers the "Vendor Messages" modal — one entry per vendor (their
 *       latest message), newest first. Marks all unread vendor messages as
 *       read as a side effect.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Vendor messages fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   post:
 *     summary: Send an in-app message to a vendor (admin)
 *     description: Powers the "Send Message" modal.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, message]
 *             properties:
 *               vendorId: { type: string }
 *               message: { type: string, maxLength: 2000 }
 *     responses:
 *       "201":
 *         description: Message sent to vendor successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/communications/call-logs:
 *   get:
 *     summary: List recent vendor call logs (admin)
 *     description: Powers the "Call Logs" modal.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Vendor call logs fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   post:
 *     summary: Log a call with a vendor (admin)
 *     description: >-
 *       Records call metadata only — the actual call is placed by the
 *       admin's phone/dialer; this just logs it for the Communications tab.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, durationSeconds]
 *             properties:
 *               vendorId: { type: string }
 *               durationSeconds: { type: number, minimum: 0 }
 *               notes: { type: string, maxLength: 1000 }
 *     responses:
 *       "201":
 *         description: Call logged successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/vendor-relations/activity:
 *   get:
 *     summary: List recent Vendor Relations admin activity (admin)
 *     description: >-
 *       Powers the Communications tab's "Recent Activity" feed — derived
 *       from the admin audit log, filtered to vendor-relations actions.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Recent vendor relations activity fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class AdminVendorRelationsRouter {
  private controller: AdminVendorRelationsController;
  router: Router;

  constructor() {
    this.controller = new AdminVendorRelationsController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/overview", this.controller.getOverviewStats);

    this.router.get(
      "/paystack-subaccounts",
      this.controller.getPaystackSubaccountIssues,
    );
    this.router.post(
      "/paystack-subaccounts/:vendorId/retry",
      adminSensitiveActionRateLimitMiddleware,
      this.controller.retryPaystackSubaccount,
    );

    this.router.get("/applications", this.controller.getVendorApplications);
    this.router.get(
      "/applications/:vendorId",
      this.controller.getVendorApplicationDetail,
    );
    this.router.patch(
      "/applications/:vendorId/approve",
      adminSensitiveActionRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
      this.controller.approveVendorApplication,
    );
    this.router.patch(
      "/applications/:vendorId/reject",
      adminSensitiveActionRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
      zodValidation(rejectVendorApplicationSchema),
      this.controller.rejectVendorApplication,
    );

    this.router.get("/performance", this.controller.getVendorPerformance);
    this.router.get(
      "/performance/:vendorId",
      this.controller.getVendorPerformanceDetail,
    );
    this.router.post(
      "/performance/:vendorId/warning",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(sendVendorWarningSchema),
      this.controller.sendWarning,
    );

    this.router.get("/issues", this.controller.getIssues);
    this.router.post(
      "/issues",
      zodValidation(createVendorIssueSchema),
      this.controller.createIssue,
    );
    this.router.get("/issues/:issueId", this.controller.getIssueDetail);
    this.router.patch(
      "/issues/:issueId/resolve",
      zodValidation(resolveVendorIssueSchema),
      this.controller.resolveIssue,
    );
    this.router.patch(
      "/issues/:issueId/escalate",
      this.controller.escalateIssue,
    );

    this.router.get(
      "/communications/summary",
      this.controller.getCommunicationsSummary,
    );
    this.router.get(
      "/communications/messages",
      this.controller.getVendorMessages,
    );
    this.router.post(
      "/communications/messages",
      zodValidation(sendVendorMessageSchema),
      this.controller.sendMessageToVendor,
    );
    this.router.get(
      "/communications/call-logs",
      this.controller.getCallLogs,
    );
    this.router.post(
      "/communications/call-logs",
      zodValidation(logVendorCallSchema),
      this.controller.logCall,
    );

    this.router.get("/activity", this.controller.getRecentActivity);
  }
}

export const adminVendorRelationsRouter = new AdminVendorRelationsRouter()
  .router;
