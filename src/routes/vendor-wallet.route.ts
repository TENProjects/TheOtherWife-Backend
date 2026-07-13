/** @format */

import { Router } from "express";
import { VendorWalletController } from "../controllers/vendor-wallet.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { statusCheck } from "../middlewares/status-check.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { updateVendorPayoutSettingsSchema } from "../zod-schema/vendor.schema.js";

/**
 * @swagger
 * /api/v1/vendor-wallet/summary:
 *   get:
 *     summary: Get current vendor wallet summary
 *     tags: [Vendor Wallet]
 *     responses:
 *       "200":
 *         description: Vendor wallet summary fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
/**
 * @swagger
 * /api/v1/vendor-wallet/transactions:
 *   get:
 *     summary: Get current vendor wallet transactions
 *     tags: [Vendor Wallet]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *       - in: query
 *         name: settlementStatus
 *         schema:
 *           $ref: "#/components/schemas/PaymentSettlementStatus"
 *     responses:
 *       "200":
 *         description: Vendor wallet transactions fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
/**
 * @swagger
 * /api/v1/vendor-wallet/settings:
 *   get:
 *     summary: Get current vendor's payout settings
 *     description: >-
 *       Response includes `paystackSubaccountCode` — present once Paystack
 *       Split Payment (Financial & Commission Spec v1.0, section 3.2) is live
 *       for this vendor; undefined means new orders still settle via the
 *       manual VendorPayoutRequest flow.
 *     tags: [Vendor Wallet]
 *     responses:
 *       "200":
 *         description: Vendor payout settings fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   patch:
 *     summary: Update current vendor's payout settings
 *     description: >-
 *       Saving complete bank details (bankName + accountNumber) for an
 *       approved vendor automatically creates their Paystack subaccount in
 *       the background (Financial & Commission Spec v1.0, section 3.2) —
 *       once created, new orders split 80% to this vendor instantly at
 *       checkout instead of requiring a manual payout request. Subaccount
 *       creation failures (e.g. unrecognized bank name) never block this
 *       settings save itself; check GET /vendor-wallet/settings afterward if
 *       automatic split payouts don't start appearing.
 *     tags: [Vendor Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorPayoutSettingsUpdatePayload"
 *     responses:
 *       "200":
 *         description: Vendor payout settings updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
/**
 * @swagger
 * /api/v1/vendor-wallet/payout-requests:
 *   post:
 *     summary: Create payout request for current vendor
 *     tags: [Vendor Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorPayoutRequestCreatePayload"
 *     responses:
 *       "201":
 *         description: Vendor payout request created successfully
 *       "400":
 *         description: Bad request
 *   get:
 *     summary: List current vendor payout requests
 *     tags: [Vendor Wallet]
 *     responses:
 *       "200":
 *         description: Vendor payout requests fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
class VendorWalletRouter {
  private vendorWalletController: VendorWalletController;
  router: Router;

  constructor() {
    this.vendorWalletController = new VendorWalletController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/summary",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.vendorWalletController.getSummary,
    );
    this.router.get(
      "/transactions",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.vendorWalletController.getTransactions,
    );
    this.router.post(
      "/payout-requests",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.vendorWalletController.requestPayout,
    );
    this.router.get(
      "/payout-requests",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.vendorWalletController.getPayoutRequests,
    );
    this.router.get(
      "/settings",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      this.vendorWalletController.getPayoutSettings,
    );
    this.router.patch(
      "/settings",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      statusCheck(["approved"]),
      zodValidation(updateVendorPayoutSettingsSchema),
      this.vendorWalletController.updatePayoutSettings,
    );
  }
}

export const vendorWalletRouter = new VendorWalletRouter().router;
