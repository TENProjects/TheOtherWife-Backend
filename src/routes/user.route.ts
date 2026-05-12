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
} from "../zod-schema/user.schema.js";

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
 *      tags: [User]
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
 *     summary: Get all customers with profile details (admin)
 *     tags: [User]
 *     responses:
 *       "200":
 *         description: Customers fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/users/vendors:
 *   get:
 *     summary: Get all vendors with profile details (admin)
 *     tags: [User]
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
 *     tags: [User]
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
 *     tags: [User]
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
      this.userController.getAllUsers,
    );
    this.router.get(
      "/customers",
      roleGuardMiddleware(["admin"]),
      this.userController.getAllCustomers,
    );
    this.router.get(
      "/vendors",
      roleGuardMiddleware(["admin"]),
      this.userController.getAllVendors,
    );
    this.router.patch(
      "/:userId/status",
      roleGuardMiddleware(["admin"]),
      zodValidation(updateUserStatusSchema),
      this.userController.updateUserStatus,
    );

    this.router.post(
      "/admins",
      roleGuardMiddleware(["admin"]),
      zodValidation(createAdminUserSchema),
      this.userController.createAdminUser,
    );
  }
}

export const userRouter = new UserRouter().router;
