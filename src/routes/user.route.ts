/** @format */

import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";

import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  closeCurrentUserAccountSchema,
  createAdminUserSchema,
  updateUserStatusSchema,
  assignCustomerGroupSchema,
  updateCustomerAdminNotesSchema,
} from "../zod-schema/user.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user
 *     tags: [User]
 *     responses:
 *       "200":
 *         description: User fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
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
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 *   delete:
 *     summary: Close current user account
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       "204":
 *         description: User account closed successfully
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
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 *  /api/v1/users:
 *    get:
 *      summary: Get all users (admin)
 *      tags: [Admin]
 *      responses:
 *        "200":
 *          description: Users fetched successfully
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/schemas/ApiResponse"
 *        "400":
 *          description: Bad request
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/responses/400"
 *        "401":
 *          description: Unauthorized
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/responses/401"
 *        "403":
 *          description: Forbidden
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/responses/403"
 *        "404":
 *          description: Not found
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/responses/404"
 *        "500":
 *          description: Internal server error
 *          content:
 *              application/json:
 *                schema:
 *                  $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/users/customers:
 *   get:
 *     summary: Get all customers with profile, order, and group details (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Matches against first name, last name, email, or phone number
 *       - in: query
 *         name: group
 *         required: false
 *         schema:
 *           type: string
 *           enum: [VIP, Regular, New, At Risk, Blocked]
 *         description: Case-insensitive; also accepts lowercase/hyphenated forms (e.g. "at-risk")
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [active, suspended]
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
 *           description: Max 500, default 100
 *     responses:
 *       "200":
 *         description: Customers fetched successfully
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
 *                         customers:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id: { type: string, description: "User id — the canonical id for all customer admin actions" }
 *                               customerId: { type: string }
 *                               name: { type: string }
 *                               firstName: { type: string }
 *                               lastName: { type: string }
 *                               email: { type: string }
 *                               phone: { type: string }
 *                               location: { type: string }
 *                               orders: { type: number }
 *                               totalSpent: { type: number }
 *                               group: { type: string, enum: [VIP, Regular, New, "At Risk", Blocked] }
 *                               status: { type: string, enum: [Active, Suspended, Deleted] }
 *                               adminNotes: { type: string }
 *                               createdAt: { type: string, format: date-time }
 *                         stats:
 *                           type: object
 *                           description: Computed across the full filtered result set, not just the current page
 *                           properties:
 *                             totalCustomers: { type: number }
 *                             activeCustomers: { type: number }
 *                             vipCustomers: { type: number }
 *                             newThisMonth: { type: number }
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/users/customers/{userId}/group:
 *   patch:
 *     summary: Assign a customer to a segmentation group (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer's User id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [group]
 *             properties:
 *               group:
 *                 type: string
 *                 description: Case-insensitive; also accepts lowercase/hyphenated forms
 *                 enum: [VIP, Regular, New, "At Risk", Blocked]
 *     responses:
 *       "200":
 *         description: Customer group updated successfully
 *       "400":
 *         description: Invalid group value
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Customer not found
 */

/**
 * @swagger
 * /api/v1/users/customers/{userId}/notes:
 *   patch:
 *     summary: Update an admin's internal notes on a customer (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer's User id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [adminNotes]
 *             properties:
 *               adminNotes: { type: string, maxLength: 2000 }
 *     responses:
 *       "200":
 *         description: Customer notes updated successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Customer not found
 */

/**
 * @swagger
 * /api/v1/users/customers/{userId}/reset-password:
 *   post:
 *     summary: Trigger a password reset email for a customer (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The customer's User id
 *     responses:
 *       "200":
 *         description: Password reset email sent to customer
 *       "400":
 *         description: Cannot reset password for a deleted account
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Customer not found
 */

/**
 * @swagger
 * /api/v1/users/vendors:
 *   get:
 *     summary: Get all vendors with profile details (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Vendors fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/users/{userId}/status:
 *   patch:
 *     summary: Update a user's account status (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, deleted]
 *     responses:
 *       "200":
 *         description: User status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
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
 *       "404":
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/404"
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/users/admins:
 *   post:
 *     summary: Create a new admin user (admin only)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, email, password, phoneNumber]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               phoneNumber: { type: string }
 *     responses:
 *       "201":
 *         description: Admin user created successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class UserRouter {
  userController: UserController;
  router: Router;

  constructor() {
    this.userController = new UserController();
    this.router = Router();
    this.router.use(authMiddleware);
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/me",
      roleGuardMiddleware(["customer", "vendor"]),
      this.userController.getCurrentUser,
    );

    this.router.delete(
      "/me",
      roleGuardMiddleware(["customer", "vendor", "admin"]),
      zodValidation(closeCurrentUserAccountSchema),
      this.userController.closeCurrentUserAccount,
    );

    this.router.get(
      "/",
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.userController.getAllUsers,
    );
    this.router.get(
      "/customers",
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.userController.getAllCustomers,
    );
    this.router.patch(
      "/customers/:userId/group",
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(assignCustomerGroupSchema),
      this.userController.assignCustomerGroup,
    );
    this.router.patch(
      "/customers/:userId/notes",
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateCustomerAdminNotesSchema),
      this.userController.updateCustomerNotes,
    );
    this.router.post(
      "/customers/:userId/reset-password",
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      this.userController.resetCustomerPassword,
    );
    this.router.get(
      "/vendors",
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.userController.getAllVendors,
    );
    this.router.patch(
      "/:userId/status",
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateUserStatusSchema),
      this.userController.updateUserStatus,
    );

    this.router.post(
      "/admins",
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(createAdminUserSchema),
      this.userController.createAdminUser,
    );
  }
}

export const userRouter = new UserRouter().router;
