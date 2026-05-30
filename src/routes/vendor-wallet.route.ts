/** @format */

import { Router } from "express";
import { VendorWalletController } from "../controllers/vendor-wallet.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { statusCheck } from "../middlewares/status-check.middleware.js";

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
  }
}

export const vendorWalletRouter = new VendorWalletRouter().router;
