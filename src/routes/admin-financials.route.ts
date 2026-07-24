/** @format */

import { Router } from "express";
import { FinancialsController } from "../controllers/financials.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  testPaymentGatewayConnectionSchema,
  updateCommissionConfigSchema,
  updatePaymentGatewaySchema,
  updateSystemSettingsSchema,
  updateTaxSettingsSchema,
  updateVatSettingsSchema,
} from "../zod-schema/financials.schema.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";

/**
 * @swagger
 * /api/v1/admin/financials/summary:
 *   get:
 *     summary: Get the Financials dashboard KPI cards (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Financial summary fetched successfully
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
 *                         totalRevenue: { type: number }
 *                         totalRevenueChange: { type: number }
 *                         totalCommission: { type: number }
 *                         commissionRatePercent: { type: number }
 *                         pendingWithdrawals:
 *                           type: object
 *                           properties:
 *                             count: { type: number }
 *                             amount: { type: number }
 *                         netProfit:
 *                           type: number
 *                           description: totalCommission minus the real Paystack processing cost on totalRevenue
 *                         netProfitChange: { type: number }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/analytics:
 *   get:
 *     summary: Get Financials analytics charts (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Financial analytics fetched successfully
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
 *                         revenueProfitTrend:
 *                           type: array
 *                           description: Last 12 calendar months
 *                           items:
 *                             type: object
 *                             properties:
 *                               month: { type: string, example: "2026-07" }
 *                               revenue: { type: number }
 *                               profit: { type: number }
 *                         commissionByCategory:
 *                           type: array
 *                           description: >-
 *                             Top 10 meal categories by commission earned,
 *                             apportioned from each order's service charge
 *                             by line-item revenue share
 *                           items:
 *                             type: object
 *                             properties:
 *                               category: { type: string }
 *                               commission: { type: number }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/payment-gateways:
 *   get:
 *     summary: List configured payment gateways (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Payment gateways fetched successfully
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
 *                         gateways:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/PaymentGatewayConfig"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/payment-gateways/{key}:
 *   patch:
 *     summary: Toggle or update a payment gateway's configuration (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *           enum: [paystack, flutterwave, stripe]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive: { type: boolean }
 *               transactionFeePercent: { type: number, minimum: 0, maximum: 100 }
 *     responses:
 *       "200":
 *         description: >-
 *           Payment gateway updated successfully. NOTE: only "paystack" has a
 *           real payment integration — activating flutterwave/stripe here only
 *           changes admin-facing configuration, it does not enable real
 *           payment processing for them.
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Unknown gateway key
 */

/**
 * @swagger
 * /api/v1/admin/financials/commission:
 *   get:
 *     summary: Get the platform commission configuration (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Commission configuration fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update the platform commission configuration (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [commissionType, commissionRate]
 *             properties:
 *               commissionType: { type: string, enum: [percentage, flat] }
 *               commissionRate: { type: number, minimum: 0 }
 *     responses:
 *       "200":
 *         description: >-
 *           Commission configuration updated successfully. NOTE: this sets
 *           the rate displayed to admins going forward — it does not
 *           retroactively recompute serviceCharge on existing orders, and
 *           order-time commission calculation in the checkout flow is
 *           unchanged (existing logic, not touched by this endpoint).
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/tax-settings:
 *   get:
 *     summary: Get the platform tax configuration (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Tax settings fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update the platform tax configuration (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [defaultRate]
 *             properties:
 *               defaultRate: { type: number, minimum: 0, maximum: 100 }
 *               categories:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     rate: { type: number, minimum: 0, maximum: 100 }
 *     responses:
 *       "200":
 *         description: >-
 *           Tax settings updated successfully. NOTE: this is configuration
 *           storage only — no order/checkout pricing logic currently reads
 *           these values (existing checkout tax calculation, if any, is
 *           unchanged and not touched by this endpoint).
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/orders/{orderId}/profit:
 *   get:
 *     summary: Per-order profit breakdown (admin) — Financial Spec section 7.1
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Order profit breakdown fetched successfully
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
 *                         mealSubtotal: { type: number }
 *                         processingFee: { type: number }
 *                         vat: { type: number }
 *                         customerTotal: { type: number }
 *                         paystackFee: { type: number }
 *                         homeChefPayout: { type: number }
 *                         towCommission: { type: number }
 *                         refundAbsorbed: { type: number, description: Scenario B dispute refunds only }
 *                         promoDiscountCost: { type: number }
 *                         towNetProfit: { type: number }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/financials/net-profit-summary:
 *   get:
 *     summary: Aggregated net-profit dashboard cards (admin) — Financial Spec section 7.2
 *     description: Omit both from/to for an all-time summary.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       "200":
 *         description: Net profit summary fetched successfully
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
 *                         totalGMV: { type: number }
 *                         totalProcessingFees: { type: number }
 *                         totalVatCollected: { type: number }
 *                         totalPaystackCosts: { type: number }
 *                         totalCommissions: { type: number }
 *                         totalRefundsIssued: { type: number }
 *                         totalPromoCosts: { type: number }
 *                         grossRevenue: { type: number }
 *                         totalCosts: { type: number }
 *                         netProfit: { type: number }
 *       "400":
 *         description: Bad request — from is after to
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/vat:
 *   get:
 *     summary: Get the VAT-on-processing-fee toggle state (admin)
 *     description: >-
 *       Per the Financial & Commission Specification v1.0 — VAT is 7.5% on
 *       the processing fee only (never the meal subtotal), OFF by default.
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: VAT settings fetched successfully
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
 *                         vatEnabled: { type: boolean }
 *                         vatRate: { type: number, example: 7.5 }
 *                         vatToggledAt: { type: string, format: date-time, nullable: true }
 *                         vatToggledBy: { type: string, nullable: true, description: Admin user ID }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Toggle VAT on the processing fee (admin)
 *     description: >-
 *       CRITICAL — do not enable until FIRS registration is confirmed.
 *       Requires `confirm: true` as an explicit second confirmation. Only
 *       affects new orders placed after the toggle changes; existing orders
 *       are never recalculated retroactively.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled, confirm]
 *             properties:
 *               enabled: { type: boolean }
 *               confirm:
 *                 type: boolean
 *                 enum: [true]
 *                 description: Must be exactly `true` to acknowledge the FIRS-registration warning.
 *     responses:
 *       "200":
 *         description: VAT settings updated successfully
 *       "400":
 *         description: Bad request — confirm was missing/false
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/financials/system-settings:
 *   get:
 *     summary: Get Super Admin System Control settings (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: System settings fetched successfully
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
 *                         refundAutoApprovalThreshold:
 *                           type: number
 *                           description: >-
 *                             Displayed as guidance on the refund decision
 *                             screen — does not automatically approve refund
 *                             requests.
 *                         orderDelayThresholdMinutes:
 *                           type: number
 *                           description: Used to compute the "Delays" performance metric
 *                         minimumWithdrawalAmount:
 *                           type: number
 *                           description: Enforced by POST /vendor-wallet/payout-requests
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update Super Admin System Control settings (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refundAutoApprovalThreshold: { type: number, minimum: 0 }
 *               orderDelayThresholdMinutes: { type: number, minimum: 1 }
 *               minimumWithdrawalAmount: { type: number, minimum: 0 }
 *     responses:
 *       "200":
 *         description: System settings updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class AdminFinancialsRouter {
  private financialsController: FinancialsController;
  router: Router;

  constructor() {
    this.financialsController = new FinancialsController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      requireAdminRole(["super_admin", "manager"]),
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/summary", this.financialsController.getSummary);
    this.router.get("/analytics", this.financialsController.getAnalytics);
    this.router.get(
      "/net-profit-summary",
      this.financialsController.getNetProfitSummary,
    );
    this.router.get(
      "/orders/:orderId/profit",
      this.financialsController.getOrderProfitBreakdown,
    );

    this.router.get(
      "/payment-gateways",
      this.financialsController.getPaymentGateways,
    );
    this.router.patch(
      "/payment-gateways/:key",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updatePaymentGatewaySchema),
      this.financialsController.updatePaymentGateway,
    );
    this.router.post(
      "/payment-gateways/:key/test-connect",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(testPaymentGatewayConnectionSchema),
      this.financialsController.testPaymentGatewayConnection,
    );

    this.router.get(
      "/commission",
      this.financialsController.getCommissionConfig,
    );
    this.router.patch(
      "/commission",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateCommissionConfigSchema),
      this.financialsController.updateCommissionConfig,
    );

    this.router.get(
      "/tax-settings",
      this.financialsController.getTaxSettings,
    );
    this.router.patch(
      "/tax-settings",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateTaxSettingsSchema),
      this.financialsController.updateTaxSettings,
    );

    this.router.get("/vat", this.financialsController.getVatSettings);
    this.router.patch(
      "/vat",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateVatSettingsSchema),
      this.financialsController.updateVatSettings,
    );

    this.router.get(
      "/system-settings",
      this.financialsController.getSystemSettings,
    );
    this.router.patch(
      "/system-settings",
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateSystemSettingsSchema),
      this.financialsController.updateSystemSettings,
    );
  }
}

export const adminFinancialsRouter = new AdminFinancialsRouter().router;
