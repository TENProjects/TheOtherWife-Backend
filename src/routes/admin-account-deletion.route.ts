/** @format */

import { Router } from "express";
import { AccountDeletionController } from "../controllers/account-deletion.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/account-deletions:
 *   get:
 *     summary: List customer accounts currently in their 30-day deletion grace period (Super Admin)
 *     description: >-
 *       Only full-delete requests are listed — erase-activity requests are
 *       instant and non-reversible, they never leave the account pending.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: number }
 *       - in: query
 *         name: limit
 *         schema: { type: number, description: "Max 100, default 20" }
 *     responses:
 *       "200":
 *         description: Pending account deletions fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *
 * /api/v1/admin/account-deletions/{userId}/cancel:
 *   post:
 *     summary: Manually cancel a pending account-deletion request, reactivating the account (Super Admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Deletion request cancelled — account reactivated
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: No pending deletion request found for this account
 */
class AdminAccountDeletionRouter {
  private controller: AccountDeletionController;
  router: Router;

  constructor() {
    this.controller = new AccountDeletionController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.handleListPending);
    this.router.post(
      "/:userId/cancel",
      adminSensitiveActionRateLimitMiddleware,
      this.controller.handleAdminCancel,
    );
  }
}

export const adminAccountDeletionRouter = new AdminAccountDeletionRouter()
  .router;
