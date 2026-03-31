/** @format */

import { Router } from "express";
import { OrderController } from "../controllers/order.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { statusCheck } from "../middlewares/status-check.middleware.js";

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

class OrderRouter {
  orderController: OrderController;
  router: Router;

  constructor() {
    this.orderController = new OrderController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
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
