/** @format */

import { Router } from "express";
import { VendorWalletController } from "../controllers/vendor-wallet.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { requireAdminRole } from "../middlewares/require-admin-role.middleware.js";

// Moving money (approve, reject, mark paid, send) is limited to finance
// roles; support agents can still view payout requests.
const financeRolesOnly = requireAdminRole(["super_admin", "manager"]);
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/vendor-payout-requests:
 *   get:
 *     summary: List vendor payout requests (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           $ref: "#/components/schemas/VendorPayoutRequestStatus"
 *     responses:
 *       "200":
 *         description: Vendor payout requests fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */
/**
 * @swagger
 * /api/v1/admin/vendor-payout-requests/{requestId}:
 *   get:
 *     summary: Get vendor payout request by id (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor payout request fetched successfully
 *       "404":
 *         description: Not found
 *   patch:
 *     summary: Update vendor payout request status/payment status (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AdminVendorPayoutRequestUpdatePayload"
 *     responses:
 *       "200":
 *         description: Vendor payout request updated successfully
 *       "400":
 *         description: Bad request
 *       "404":
 *         description: Not found
 */
class AdminVendorPayoutRouter {
  private vendorWalletController: VendorWalletController;
  router: Router;

  constructor() {
    this.vendorWalletController = new VendorWalletController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.vendorWalletController.getAdminPayoutRequests);
    this.router.get("/:requestId", this.vendorWalletController.getAdminPayoutRequestById);
    this.router.get(
      "/:requestId/transfer-preview",
      financeRolesOnly,
      this.vendorWalletController.getPayoutTransferPreview,
    );
    this.router.post(
      "/:requestId/send",
      financeRolesOnly,
      adminSensitiveActionRateLimitMiddleware,
      this.vendorWalletController.sendPayoutTransfer,
    );
    this.router.patch(
      "/:requestId",
      financeRolesOnly,
      adminSensitiveActionRateLimitMiddleware,
      this.vendorWalletController.updateAdminPayoutRequest,
    );
  }
}

export const adminVendorPayoutRouter = new AdminVendorPayoutRouter().router;
