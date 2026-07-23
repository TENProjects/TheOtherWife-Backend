/** @format */

import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/users:
 *   get:
 *     summary: List admin accounts (Role-Based Access Control screen)
 *     description: >-
 *       Scoped to userType:"admin" only — the separate customer/vendor
 *       directory lives at /api/v1/admin/user-directory. To deactivate or
 *       reactivate an admin account, use the existing
 *       PATCH /api/v1/users/{userId}/status endpoint with
 *       {"status":"suspended"} or {"status":"active"} — already admin-only
 *       and already works for any user type, so it isn't duplicated here.
 *     tags: [Admin - User Management]
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
 *         name: search
 *         schema: { type: string }
 *         description: Matches against first name, last name, or email
 *     responses:
 *       "200":
 *         description: Admin users fetched successfully
 *
 * /api/v1/admin/users/{id}/reset-password:
 *   post:
 *     summary: >-
 *       Trigger a password-reset email for an admin account, on their
 *       behalf. Reuses the existing forgot-password token + email flow.
 *     tags: [Admin - User Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Password reset email sent to the admin user
 *       "404":
 *         description: Admin user not found
 */

class AdminUserManagementRouter {
  router: Router;
  controller: UserController;

  constructor() {
    this.router = Router();
    this.controller = new UserController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getAdminUsers);
    this.router.post(
      "/:id/reset-password",
      adminSensitiveActionRateLimitMiddleware,
      this.controller.resetAdminPassword,
    );
  }
}

export const adminUserManagementRouter = new AdminUserManagementRouter()
  .router;
