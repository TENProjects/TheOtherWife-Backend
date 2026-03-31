/** @format */

import { Router } from "express";
import { VendorOnboardingController } from "../controllers/vendor-onboarding.controller.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  vendorOnboardingUploadSignatureSchema,
  vendorOnboardingStep1Schema,
  vendorOnboardingStep2Schema,
  vendorOnboardingStep3Schema,
} from "../zod-schema/vendor-onboarding.schema.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";

/**
 * @swagger
 * /api/v1/vendor-onboarding/step-1:
 *   post:
 *     summary: Complete vendor onboarding step 1
 *     tags: [Vendor Onboarding]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorOnboardingStep1Request"
 *     responses:
 *       "201":
 *         description: Vendor onboarding step 1 completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *
 * /api/v1/vendor-onboarding/upload-signature:
 *   post:
 *     summary: Generate a Cloudinary upload signature for vendor onboarding documents
 *     tags: [Vendor Onboarding]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorOnboardingUploadSignatureRequest"
 *     responses:
 *       "200":
 *         description: Upload signature generated successfully
 *
 * /api/v1/vendor-onboarding/step-2:
 *   post:
 *     summary: Complete vendor onboarding step 2
 *     tags: [Vendor Onboarding]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorOnboardingStep2Request"
 *     responses:
 *       "200":
 *         description: Vendor onboarding step 2 completed
 *
 * /api/v1/vendor-onboarding/step-3:
 *   post:
 *     summary: Complete vendor onboarding step 3
 *     tags: [Vendor Onboarding]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/VendorOnboardingStep3Request"
 *     responses:
 *       "200":
 *         description: Vendor onboarding step 3 completed
 *
 * /api/v1/vendor-onboarding/submit:
 *   post:
 *     summary: Submit vendor onboarding
 *     tags: [Vendor Onboarding]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       "200":
 *         description: Vendor onboarding submitted successfully
 *
 * /api/v1/vendor-onboarding/me:
 *   get:
 *     summary: Get current vendor onboarding state
 *     tags: [Vendor Onboarding]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       "200":
 *         description: Vendor onboarding fetched successfully
 */

class VendorOnboardingRouter {
  router: Router;
  vendorOnboardingController: VendorOnboardingController;

  constructor() {
    this.router = Router();
    this.vendorOnboardingController = new VendorOnboardingController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/step-1",
      zodValidation(vendorOnboardingStep1Schema),
      this.vendorOnboardingController.step1,
    );
    this.router.post(
      "/upload-signature",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      zodValidation(vendorOnboardingUploadSignatureSchema),
      this.vendorOnboardingController.getUploadSignature,
    );
    this.router.post(
      "/step-2",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      zodValidation(vendorOnboardingStep2Schema),
      this.vendorOnboardingController.step2,
    );
    this.router.post(
      "/step-3",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      zodValidation(vendorOnboardingStep3Schema),
      this.vendorOnboardingController.step3,
    );
    this.router.post(
      "/submit",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorOnboardingController.submit,
    );
    this.router.get(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorOnboardingController.getCurrent,
    );
  }
}

export const vendorOnboardingRouter = new VendorOnboardingRouter().router;
