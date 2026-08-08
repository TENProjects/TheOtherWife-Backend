/** @format */

import { Router } from "express";
import { HomeChefApplicationController } from "../controllers/home-chef-application.controller.js";
import { authRateLimitMiddleware } from "../middlewares/auth-rate-limit.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import { createHomeChefApplicationSchema } from "../zod-schema/home-chef-application.schema.js";

/**
 * @swagger
 * /api/v1/homechef-applications:
 *   post:
 *     summary: Submit a "Become a HomeChef" application (public, no account required)
 *     tags: [HomeChef Applications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, whatsapp, location, cuisine, hygieneCert, capacity, bio, termsAccepted]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               whatsapp: { type: string }
 *               location: { type: string }
 *               cuisine: { type: string }
 *               hygieneCert: { type: string }
 *               capacity: { type: string }
 *               socialLink: { type: string }
 *               bio: { type: string }
 *               termsAccepted: { type: boolean }
 *     responses:
 *       "201":
 *         description: Application submitted successfully
 */

class HomeChefApplicationRouter {
  router: Router;
  controller: HomeChefApplicationController;

  constructor() {
    this.router = Router();
    this.controller = new HomeChefApplicationController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/",
      authRateLimitMiddleware,
      zodValidation(createHomeChefApplicationSchema),
      this.controller.create,
    );
  }
}

export const homeChefApplicationRouter = new HomeChefApplicationRouter().router;
