/** @format */

import { Router } from "express";
import { VendorController } from "../controllers/vendor.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  updateVendorAvailabilitySchema,
  updateVendorInspectionStatusSchema,
  updateVendorProfileSchema,
} from "../zod-schema/vendor.schema.js";
import { uploadBusinessLogo } from "../middlewares/file-upload.middleware.js";
import { uploadBusinessLogoToCloudinary } from "../middlewares/cloudinary-upload.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/vendors/featured:
 *   get:
 *     summary: Get featured vendors ranked by rating score and order volume
 *     tags: [Vendor]
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *       - in: query
 *         name: radius
 *         required: false
 *         description: >-
 *           Search width in kilometers from the customer's address
 *           (e.g. 10, 20, 50). Clamped between 1 and 100; defaults to the
 *           SEARCH_RADIUS_KM server setting. Only applied for customers with a
 *           saved address.
 *         schema:
 *           type: number
 *     responses:
 *       "200":
 *         description: Featured vendors fetched successfully
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
 *                         vendors:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/Vendor"
 *                         meta:
 *                           type: object
 *                           properties:
 *                             limit: { type: number }
 *                             searchRadius:
 *                               $ref: "#/components/schemas/SearchRadius"
 */

/**
 * @swagger
 * /api/v1/vendors:
 *   get:
 *     summary: List all vendors (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           $ref: "#/components/schemas/VendorApprovalStatus"
 *         description: Filter by approval status
 *     responses:
 *       "200":
 *         description: Vendors fetched successfully
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
 *                         vendors:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/Vendor"
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
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/vendors/pending:
 *   get:
 *     summary: List vendors pending approval (admin)
 *     tags: [Admin]
 *     responses:
 *       "200":
 *         description: Pending vendors fetched successfully
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
 *                         vendors:
 *                           type: array
 *                           items:
 *                             $ref: "#/components/schemas/Vendor"
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
 *       "500":
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/responses/500"
 */

/**
 * @swagger
 * /api/v1/vendors/admin/{id}:
 *   get:
 *     summary: Get full vendor details by ID for any approval status (admin)
 *     description: >-
 *       Unlike GET /vendors/{id} (public, approved-only), this works for
 *       pending, rejected, and suspended vendors too, and includes
 *       admin-only fields: email/phone, rejectionReason, inspectionStatus,
 *       application date, verification documents, and order count.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor details fetched successfully
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
 *                         vendor:
 *                           type: object
 *                           properties:
 *                             numberOfOrders: { type: number }
 *                             applicationDate: { type: string, format: date-time, nullable: true }
 *                             cuisines: { type: array, items: { type: string } }
 *                             businessType:
 *                               type: string
 *                               nullable: true
 *                               description: >-
 *                                 Always null — no business-type/category field
 *                                 exists in the vendor schema, only `cuisines`.
 *                             documents:
 *                               type: object
 *                               properties:
 *                                 governmentId: { type: object, nullable: true }
 *                                 businessCertificate: { type: object, nullable: true }
 *                                 displayImage: { type: object, nullable: true }
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/vendors/admin/{id}/inspection-status:
 *   patch:
 *     summary: Update a vendor's manual inspection/verification status (admin)
 *     description: >-
 *       Tracks an admin's manual document/business review progress,
 *       separate from approvalStatus (approve/reject is a distinct action).
 *     tags: [Admin]
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
 *             required: [inspectionStatus]
 *             properties:
 *               inspectionStatus:
 *                 type: string
 *                 enum: [not_started, in_progress, completed]
 *     responses:
 *       "200":
 *         description: Vendor inspection status updated successfully
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
 * /api/v1/vendors/{id}:
 *   get:
 *     summary: Get a vendor public details by ID
 *     tags: [Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Vendor public details fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "404":
 *         description: Not found
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
 *               $ref: "#/components/schemas/VendorAvailabilityResponse"
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
 *             $ref: "#/components/schemas/VendorAvailabilityUpdateRequest"
 *     responses:
 *       "200":
 *         description: Vendor availability updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/VendorAvailabilityResponse"
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
 *               expoTokens:
 *                 type: array
 *                 items: { type: string }
 *               pushNotificationsEnabled: { type: boolean }
 *               cuisines:
 *                 type: string
 *                 description: Comma-separated cuisine list (e.g. "Local,Continental"), stored under additionalData.business.cuisines
 *               yearsOfExperience: { type: number }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               latitude:
 *                 type: number
 *                 description: Precise geocoded latitude. Falls back to a state-capital centroid if omitted while creating a new address.
 *               longitude:
 *                 type: number
 *                 description: Precise geocoded longitude. Falls back to a state-capital centroid if omitted while creating a new address.
 *               postalCode: { type: string }
 *               country: { type: string }
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
 *     tags: [Admin]
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
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           required: true
 *           description: The vendor ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rejectionReason:
 *                 type: string
 *                 description: Either this or `reason` may be used.
 *               reason:
 *                 type: string
 *                 description: Alias for rejectionReason.
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
 *     tags: [Admin]
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
    // Must be registered before "/:id" or Express would match "pending" as an id.
    this.router.get(
      "/pending",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.vendorController.getPendingVendorsForAdmin,
    );
    this.router.get(
      "/",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.vendorController.getAllVendorsForAdmin,
    );
    this.router.get(
      "/admin/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.vendorController.getVendorDetailsForAdmin,
    );
    this.router.patch(
      "/admin/:id/inspection-status",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminSensitiveActionRateLimitMiddleware,
      zodValidation(updateVendorInspectionStatusSchema),
      this.vendorController.updateVendorInspectionStatus,
    );
    this.router.get("/:id", this.vendorController.getPublicVendorDetails);
    this.router.put(
      "/approve/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.vendorController.approveVendor,
    );
    this.router.put(
      "/reject/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
      this.vendorController.rejectVendor,
    );
    this.router.put(
      "/suspend/:id",
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
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
