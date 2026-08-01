/** @format */

import { Router } from "express";
import { AccountDeletionController } from "../controllers/account-deletion.controller.js";
import { authRateLimitMiddleware } from "../middlewares/auth-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  requestAccountDeletionSchema,
  verifyAccountDeletionSchema,
  confirmAccountDeletionSchema,
} from "../zod-schema/account-deletion.schema.js";

/**
 * @swagger
 * /api/v1/account-deletion/request:
 *   post:
 *     summary: Request account deletion (public, unauthenticated). Sends a 6-digit email OTP.
 *     description: >-
 *       Always returns the same generic response regardless of whether the
 *       email exists, to avoid account enumeration. If the email belongs to
 *       a vendor account, no OTP is issued — an email directing them to
 *       support is sent instead.
 *     tags: [Account Deletion]
 *     security: []
 *     responses:
 *       "200":
 *         description: Generic acknowledgement
 *
 * /api/v1/account-deletion/verify:
 *   post:
 *     summary: Verify the 6-digit OTP and receive a short-lived deletion session token (public)
 *     tags: [Account Deletion]
 *     security: []
 *     responses:
 *       "200":
 *         description: Returns { deletionToken, deletionType, eligibility }
 *       "400":
 *         description: Invalid/expired code or too many attempts
 *
 * /api/v1/account-deletion/confirm:
 *   post:
 *     summary: Confirm the deletion request using the deletion session token (public)
 *     tags: [Account Deletion]
 *     security: []
 *     responses:
 *       "200":
 *         description: Returns { reference }
 *       "400":
 *         description: Invalid/expired deletion session token
 *       "409":
 *         description: Ineligible — wallet balance to spend or orders still in progress
 */
class AccountDeletionRouter {
  router: Router;
  controller: AccountDeletionController;

  constructor() {
    this.router = Router();
    this.controller = new AccountDeletionController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/request",
      authRateLimitMiddleware,
      zodValidation(requestAccountDeletionSchema),
      this.controller.handleRequest,
    );
    this.router.post(
      "/verify",
      authRateLimitMiddleware,
      zodValidation(verifyAccountDeletionSchema),
      this.controller.handleVerify,
    );
    this.router.post(
      "/confirm",
      authRateLimitMiddleware,
      zodValidation(confirmAccountDeletionSchema),
      this.controller.handleConfirm,
    );
  }
}

export const accountDeletionRouter = new AccountDeletionRouter().router;
