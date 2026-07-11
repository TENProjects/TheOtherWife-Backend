/** @format */

import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { adminRateLimitMiddleware } from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/user-directory:
 *   get:
 *     summary: Unified customer + vendor directory for Super Admin (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Matches against first name, last name, email, or phone number
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [customer, vendor]
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
 *           description: Max 200, default 50
 *     responses:
 *       "200":
 *         description: User directory fetched successfully
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
 *                         users:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id: { type: string }
 *                               name: { type: string }
 *                               email: { type: string }
 *                               type: { type: string, enum: [Customer, Vendor] }
 *                               status: { type: string, enum: [Active, Suspended] }
 *                               verified:
 *                                 type: boolean
 *                                 description: >-
 *                                   Vendors: approvalStatus === "approved".
 *                                   Customers: isEmailVerified.
 *                               vendorBusinessName: { type: string, nullable: true }
 *                               joinDate: { type: string, format: date-time }
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/user-directory/{id}:
 *   get:
 *     summary: Unified user detail (customer or vendor) for Super Admin (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: User details fetched successfully
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
 *                         _id: { type: string }
 *                         name: { type: string }
 *                         userType: { type: string, enum: [customer, vendor, admin] }
 *                         status: { type: string, enum: [Active, Suspended, Deleted] }
 *                         statusReason: { type: string, nullable: true }
 *                         verified: { type: boolean }
 *                         joinDate: { type: string, format: date-time }
 *                         email: { type: string }
 *                         phone: { type: string, nullable: true }
 *                         location: { type: string, nullable: true }
 *                         vendorBusinessName: { type: string, nullable: true }
 *                         totalOrders: { type: number }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

class AdminUserDirectoryRouter {
  private userController: UserController;
  router: Router;

  constructor() {
    this.userController = new UserController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.userController.getUserDirectoryForAdmin);
    this.router.get("/:id", this.userController.getUserDetailsForAdmin);
  }
}

export const adminUserDirectoryRouter = new AdminUserDirectoryRouter().router;
