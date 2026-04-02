/** @format */

import { Router } from "express";
import z from "zod";
import { UploadController } from "../controllers/upload.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { cloudinaryUploadAssetTypeSchema } from "../zod-schema/cloudinary.schema.js";

const cloudinaryUploadSignatureRequestSchema = z.object({
  assetType: cloudinaryUploadAssetTypeSchema,
});

/**
 * @swagger
 * /api/v1/uploads/cloudinary-signature:
 *   post:
 *     summary: Generate a Cloudinary upload signature
 *     tags: [Upload]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CloudinaryUploadSignatureRequest"
 *     responses:
 *       "200":
 *         description: Cloudinary upload signature generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

class UploadRouter {
  router: Router;
  uploadController: UploadController;

  constructor() {
    this.router = Router();
    this.uploadController = new UploadController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/cloudinary-signature",
      authMiddleware,
      roleGuardMiddleware(["customer", "vendor"]),
      zodValidation(cloudinaryUploadSignatureRequestSchema),
      this.uploadController.getCloudinaryUploadSignature,
    );
  }
}

export const uploadRouter = new UploadRouter().router;
