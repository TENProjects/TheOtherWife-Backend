/** @format */

import { Router } from "express";
import { OrderController } from "../controllers/order.controller.js";
import { RefundController } from "../controllers/refund.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { statusCheck } from "../middlewares/status-check.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { createRefundRequestSchema } from "../zod-schema/refund.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/orders/vendor:
 *   get:
 *     summary: Get current vendor's orders
 *     tags: [Order]
 *     responses:
 *       "200":
 *         description: Vendor orders fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/orders/vendor/{orderId}:
 *   get:
 *     summary: Get a vendor order by ID
 *     tags: [Order]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor order fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/orders/vendor/{orderId}/accept:
 *   patch:
 *     summary: Accept a paid order
 *     tags: [Order]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Order accepted successfully
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
 * /api/v1/orders/vendor/{orderId}/reject:
 *   patch:
 *     summary: Reject a paid order
 *     tags: [Order]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Order rejected successfully
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
 * /api/v1/orders/me:
 *   get:
 *     summary: Get current user's orders
 *     tags: [Order]
 *     responses:
 *       "200":
 *         description: Orders fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/orders/{orderId}:
 *   get:
 *     summary: Get a current user's order by ID
 *     tags: [Order]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Order fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/orders/{id}/refund-request:
 *   post:
 *     summary: Request a refund for an order (customer or admin)
 *     tags: [Order]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Defaults to the order's full totalAmount if omitted
 *               reason: { type: string, maxLength: 1000 }
 *     responses:
 *       "201":
 *         description: Refund request submitted successfully
 *       "400":
 *         description: >-
 *           Bad request — payment not succeeded, invalid amount, or a
 *           pending refund request already exists for this order
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden — order does not belong to this customer
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/orders/admin:
 *   get:
 *     summary: List all orders across vendors/customers (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
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
 *           description: Max 100, default 50
 *     responses:
 *       "200":
 *         description: Orders fetched successfully
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
 *                         orders:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               _id: { type: string }
 *                               vendorName: { type: string }
 *                               customerName: { type: string }
 *                               amount: { type: number }
 *                               status: { type: string }
 *                               paymentStatus: { type: string }
 *                               hasPendingRefundRequest: { type: boolean }
 *                               date: { type: string, format: date-time }
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/orders/admin/performance-metrics:
 *   get:
 *     summary: Platform performance metrics for Super Admin (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Platform performance metrics fetched successfully
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
 *                         totalOrders: { type: number }
 *                         revenue: { type: number }
 *                         delays:
 *                           type: number
 *                           description: >-
 *                             Orders still pending_payment/paid past
 *                             orderDelayThresholdMinutes since creation
 *                         delayThresholdMinutes: { type: number }
 *                         refundRate:
 *                           type: number
 *                           description: Percent of all orders with paymentStatus "refunded"
 *                         averageOrderValue: { type: number }
 *                         customerSatisfactionRate:
 *                           type: number
 *                           nullable: true
 *                           description: >-
 *                             Always null — no satisfaction rating is
 *                             captured anywhere in the schema.
 *                         vendorResponseTimeMinutes:
 *                           type: number
 *                           nullable: true
 *                           description: >-
 *                             Always null — no per-status-transition
 *                             timestamp exists to derive this honestly.
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/orders/admin/{id}:
 *   get:
 *     summary: Get full order details for any order (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Order details fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

class OrderRouter {
  orderController: OrderController;
  refundController: RefundController;
  router: Router;

  constructor() {
    this.orderController = new OrderController();
    this.refundController = new RefundController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    // Admin routes registered before "/:orderId" (a single-segment
    // wildcard) so "admin" is never mistaken for an order id.
    this.router.get(
      "/admin",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.orderController.getAllOrdersForAdmin,
    );
    this.router.get(
      "/admin/performance-metrics",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.orderController.getPlatformPerformanceMetrics,
    );
    this.router.get(
      "/admin/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.orderController.getOrderDetailsForAdmin,
    );
    this.router.post(
      "/:id/refund-request",
      authMiddleware,
      roleGuardMiddleware(["customer", "admin"]),
      zodValidation(createRefundRequestSchema),
      this.refundController.createRefundRequest,
    );
    this.router.get(
      "/vendor",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.orderController.getVendorOrders,
    );
    this.router.get(
      "/vendor/:orderId",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.orderController.getVendorOrderById,
    );
    this.router.patch(
      "/vendor/:orderId/accept",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.orderController.acceptVendorOrder,
    );
    this.router.patch(
      "/vendor/:orderId/reject",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.orderController.rejectVendorOrder,
    );
    this.router.get(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["customer"]),
      this.orderController.getUserOrders,
    );
    this.router.get(
      "/:orderId",
      authMiddleware,
      roleGuardMiddleware(["customer"]),
      this.orderController.getUserOrderById,
    );
  }
}

export const orderRouter = new OrderRouter().router;
