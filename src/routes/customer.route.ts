/** @format */

import { CustomerController } from "../controllers/customer.controller.js";
import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { updateCurrentCustomerProfileSchema } from "../zod-schema/customer.schema.js";

/**
 * @swagger
 * /api/v1/customers/me:
 *   get:
 *     summary: Get current customer profile
 *     tags: [Customer]
 *     responses:
 *       "200":
 *         description: Current customer profile fetched
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *   put:
 *     summary: Update current customer profile
 *     tags: [Customer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profileImageUrl: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               phoneNumber: { type: string }
 *     responses:
 *       "200":
 *         description: Current customer profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *   delete:
 *     summary: Delete current customer profile
 *     tags: [Customer]
 *     responses:
 *       "204":
 *         description: Current customer profile deleted
 */

/**
 * @swagger
 * /api/v1/customers/{id}:
 *   get:
 *     summary: Get customer profile
 *     tags: [Customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The customer ID to get the customer profile
 *     responses:
 *       "200":
 *         description: Customer profile fetched
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
 * /api/v1/customers/{id}:
 *   put:
 *     summary: Update customer profile
 *     tags: [Customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The customer ID to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profileImageUrl: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               phoneNumber: { type: string }
 *     responses:
 *       "200":
 *         description: Customer updated
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
 * /api/v1/customers/{id}:
 *   delete:
 *     summary: Delete customer profile
 *     tags: [Customer]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The customer ID to delete
 *     responses:
 *       "204":
 *         description: Customer deleted
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

class CustomerRouter {
  customerController: CustomerController;
  router: Router;
  constructor() {
    this.customerController = new CustomerController();
    this.router = Router();
    this.router.use(authMiddleware);
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/me",
      roleGuardMiddleware(["customer"]),
      this.customerController.getCurrentCustomerProfile,
    );
    this.router.put(
      "/me",
      roleGuardMiddleware(["customer"]),
      zodValidation(updateCurrentCustomerProfileSchema),
      this.customerController.updateCurrentCustomerProfile,
    );
    this.router.delete(
      "/me",
      roleGuardMiddleware(["customer"]),
      this.customerController.deleteCurrentCustomerProfile,
    );
    this.router.get(
      "/:id",
      roleGuardMiddleware(["customer", "admin"]),
      this.customerController.getCustomerProfile,
    );
    this.router.put(
      "/:id",
      roleGuardMiddleware(["customer"]),
      this.customerController.updateCustomerProfile,
    );
    this.router.delete(
      "/:id",
      roleGuardMiddleware(["customer", "admin"]),
      this.customerController.deleteCustomerProfile,
    );
  }
}

export const customerRouter = new CustomerRouter().router;
