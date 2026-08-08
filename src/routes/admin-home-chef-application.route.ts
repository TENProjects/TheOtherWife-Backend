/** @format */

import { Router } from "express";
import { HomeChefApplicationController } from "../controllers/home-chef-application.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { updateHomeChefApplicationStatusSchema } from "../zod-schema/home-chef-application.schema.js";

/**
 * @swagger
 * /api/v1/admin/homechef-applications:
 *   get:
 *     summary: List HomeChef applications
 *     tags: [Admin - HomeChef Applications]
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
 *         schema: { type: string, enum: [new, contacted, inspection_scheduled, approved, rejected] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches against full name, email, or application number
 *     responses:
 *       "200":
 *         description: Applications fetched successfully
 *
 * /api/v1/admin/homechef-applications/export:
 *   get:
 *     summary: Export HomeChef applications as CSV
 *     tags: [Admin - HomeChef Applications]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: CSV file
 *
 * /api/v1/admin/homechef-applications/{id}:
 *   get:
 *     summary: Get a single HomeChef application
 *     tags: [Admin - HomeChef Applications]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       "200":
 *         description: Application fetched successfully
 *       "404":
 *         description: Application not found
 *
 * /api/v1/admin/homechef-applications/{id}/status:
 *   patch:
 *     summary: Update a HomeChef application's status and/or admin notes
 *     tags: [Admin - HomeChef Applications]
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
 *               status: { type: string, enum: [new, contacted, inspection_scheduled, approved, rejected] }
 *               adminNotes: { type: string }
 *     responses:
 *       "200":
 *         description: Application updated successfully
 */

class AdminHomeChefApplicationRouter {
  router: Router;
  controller: HomeChefApplicationController;

  constructor() {
    this.router = Router();
    this.controller = new HomeChefApplicationController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager", "support_agent"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    // "/export" is registered before "/:id" so it isn't swallowed by it.
    this.router.get("/export", this.controller.exportCsv);
    this.router.get("/", this.controller.getAdminApplications);
    this.router.get("/:id", this.controller.getAdminApplicationById);
    this.router.patch(
      "/:id/status",
      zodValidation(updateHomeChefApplicationStatusSchema),
      this.controller.updateStatus,
    );
  }
}

export const adminHomeChefApplicationRouter =
  new AdminHomeChefApplicationRouter().router;
