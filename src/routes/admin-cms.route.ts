/** @format */

import { Router } from "express";
import { SiteContentController } from "../controllers/site-content.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { updateSiteContentSchema } from "../zod-schema/site-content.schema.js";

/**
 * @swagger
 * /api/v1/admin/cms:
 *   get:
 *     summary: Get site content (About Us, contact email, contact phone)
 *     tags: [Admin - CMS]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       "200":
 *         description: Site content fetched successfully
 *   patch:
 *     summary: Update site content
 *     tags: [Admin - CMS]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               aboutUs: { type: string }
 *               contactEmail: { type: string, format: email }
 *               contactPhone: { type: string }
 *     responses:
 *       "200":
 *         description: Site content updated successfully
 */

class AdminCmsRouter {
  router: Router;
  controller: SiteContentController;

  constructor() {
    this.router = Router();
    this.controller = new SiteContentController();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getContent);
    this.router.patch(
      "/",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateSiteContentSchema),
      this.controller.updateContent,
    );
  }
}

export const adminCmsRouter = new AdminCmsRouter().router;
