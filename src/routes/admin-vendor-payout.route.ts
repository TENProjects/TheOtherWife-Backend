/** @format */

import { Router } from "express";
import { VendorWalletController } from "../controllers/vendor-wallet.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";

class AdminVendorPayoutRouter {
  private vendorWalletController: VendorWalletController;
  router: Router;

  constructor() {
    this.vendorWalletController = new VendorWalletController();
    this.router = Router();
    this.router.use(authMiddleware, roleGuardMiddleware(["admin"]));
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.vendorWalletController.getAdminPayoutRequests);
    this.router.get("/:requestId", this.vendorWalletController.getAdminPayoutRequestById);
    this.router.patch("/:requestId", this.vendorWalletController.updateAdminPayoutRequest);
  }
}

export const adminVendorPayoutRouter = new AdminVendorPayoutRouter().router;
