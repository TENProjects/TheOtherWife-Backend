/** @format */

import { Router } from "express";
import { VendorController } from "../controllers/vendor.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  updateVendorAvailabilitySchema,
  updateVendorProfileSchema,
} from "../zod-schema/vendor.schema.js";
import { uploadBusinessLogo } from "../middlewares/file-upload.middleware.js";
import { uploadBusinessLogoToCloudinary } from "../middlewares/cloudinary-upload.middleware.js";

/**
 * @swagger
 * /api/v1/vendors/featured:
 *   get:
 *     summary: Get featured vendors ranked by ratings
 *     tags: [Vendor]
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Featured vendors fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 */

/**
 * @swagger
 * /api/v1/vendors/me/reviews:
 *   get:
 *     summary: Get current vendor reviews
 *     tags: [Vendor]
 *     responses:
 *       "200":
 *         description: Vendor reviews fetched successfully
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
 * /api/v1/vendors/me:
 *   get:
 *     summary: Get vendor profile
 *     tags: [Vendor]
 *     responses:
 *       "200":
 *         description: Vendor profile retrieved successfully
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
 * /api/v1/vendors/me/availability:
 *   get:
 *     summary: Get vendor availability settings
 *     tags: [Vendor]
 *     responses:
 *       "200":
 *         description: Vendor availability fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/VendorAvailability"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   put:
 *     summary: Update vendor availability settings
 *     tags: [Vendor]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isAvailable: { type: boolean }
 *               openingHours:
 *                 $ref: "#/components/schemas/VendorOpeningHours"
 *     responses:
 *       "200":
 *         description: Vendor availability updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/VendorAvailability"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/vendors/me:
 *   put:
 *     summary: Update vendor profile
 *     tags: [Vendor]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phoneNumber: { type: string }
 *               businessName: { type: string }
 *               businessDescription: { type: string }
 *               businessLogoUrl: { type: string }
 *               businessLogo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       "200":
 *         description: Vendor profile updated successfully
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
 * /api/v1/vendors/approve/{id}:
 *   put:
 *     summary: Approve vendor
 *     tags: [Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The vendor ID
 *
 *     responses:
 *       "200":
 *         description: Vendor approved successfully
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
 * /api/v1/vendors/reject/{id}:
 *   put:
 *     summary: Reject vendor
 *     tags: [Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rejectionReason: { type: string }
 *     responses:
 *       "200":
 *         description: Vendor rejected successfully
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
 * /api/v1/vendors/suspend/{id}:
 *   put:
 *     summary: Suspend vendor
 *     tags: [Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The vendor ID
 *     responses:
 *       "200":
 *         description: Vendor suspended successfully
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
 * /api/v1/vendors/me:
 *   delete:
 *     summary: Delete vendor profile
 *     tags: [Vendor]
 *     responses:
 *       "204":
 *         description: Vendor profile deleted successfully
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

class VendorRouter {
  vendorController: VendorController;
  router: Router;

  constructor() {
    this.vendorController = new VendorController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(
      "/featured",
      optionalAuthMiddleware,
      this.vendorController.getFeaturedVendors,
    );
    this.router.get(
      "/me/reviews",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorController.getVendorReviews,
    );
    this.router.get(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorController.getVendorProfile,
    );
    this.router.get(
      "/me/availability",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorController.getVendorAvailability,
    );
    this.router.put(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      uploadBusinessLogo,
      uploadBusinessLogoToCloudinary,
      zodValidation(updateVendorProfileSchema),
      this.vendorController.updateVendorProfile,
    );
    this.router.put(
      "/me/availability",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      zodValidation(updateVendorAvailabilitySchema),
      this.vendorController.updateVendorAvailability,
    );
    this.router.put(
      "/approve/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      this.vendorController.approveVendor,
    );
    this.router.put(
      "/reject/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      this.vendorController.rejectVendor,
    );
    this.router.put(
      "/suspend/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      this.vendorController.suspendVendor,
    );
    this.router.delete(
      "/me",
      authMiddleware,
      roleGuardMiddleware(["vendor"]),
      this.vendorController.deleteVendorProfile,
    );
  }
}

export const vendorRouter = new VendorRouter().router;
