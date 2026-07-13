/** @format */

import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginUserSchema,
  resetPasswordSchema,
  registerUserSchema,
} from "../zod-schema/auth.schema.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { zodValidation } from "../middlewares/validation.js";

/**
 * @openapi
 * /api/v1/auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, password]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               userType: { type: string, enum: [customer, vendor] }
 *               phoneNumber: { type: string, nullable: true }
 *     responses:
 *       "200":
 *         description: User registered successfully
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
 * @openapi
 * /api/v1/auth/verify:
 *   get:
 *     summary: Verify a new user's email after signup (browser-facing HTML page)
 *     description: >-
 *       This is the link opened directly from the verify-signup email, not
 *       an API call made by the app — it always renders a branded HTML
 *       landing page (src/templates/verify-result.template.html), for both
 *       success and failure (invalid/expired token), rather than JSON.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The email verification token sent to the user's email
 *     responses:
 *       "200":
 *         description: Verification succeeded — renders the success HTML page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       "400":
 *         description: Invalid or expired token — renders the failure HTML page (a new verification email is sent automatically when expired)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       "404":
 *         description: Token not found — renders the failure HTML page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */

/**
 * @openapi
 * /api/v1/auth/resend-verification:
 *   post:
 *     summary: Resend the verify-signup email to the current logged-in user
 *     description: >-
 *       Lets an already-authenticated, not-yet-verified user request a
 *       fresh verification email on demand (e.g. from an in-app banner)
 *       instead of only getting one automatically on signup or on an
 *       expired-link click.
 *     tags: [Auth]
 *     responses:
 *       "200":
 *         description: Verification email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       "400":
 *         description: Email is already verified
 *       "401":
 *         description: Unauthorized
 *       "404":
 *         description: User not found
 */

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       "200":
 *         description: User login successful
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
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh user login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       "200":
 *         description: User login refreshed successfully
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
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     responses:
 *       "204":
 *         description: User logged out successfully
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

class AuthRouter {
  router: Router;
  authController: AuthController;

  constructor() {
    this.router = Router();
    this.authController = new AuthController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.post(
      "/signup",
      zodValidation(registerUserSchema),
      this.authController.handleSignup,
    );
    this.router.get("/verify", this.authController.verifySignup);
    this.router.post(
      "/resend-verification",
      authMiddleware,
      this.authController.handleResendVerificationEmail,
    );
    this.router.post(
      "/login",
      zodValidation(loginUserSchema),
      this.authController.handleLogin,
    );
    this.router.post(
      "/google",
      zodValidation(googleLoginSchema),
      this.authController.handleGoogleLogin,
    );
    this.router.post(
      "/logout",
      authMiddleware,
      this.authController.handleLogout,
    );
    this.router.post("/refresh", this.authController.handleRefreshLogin);
    this.router.post(
      "/forgot-password",
      zodValidation(forgotPasswordSchema),
      this.authController.handleForgotPassword,
    );
    this.router.post(
      "/reset-password",
      zodValidation(resetPasswordSchema),
      this.authController.handleResetPassword,
    );
    this.router.post(
      "/change-password",
      authMiddleware,
      zodValidation(changePasswordSchema),
      this.authController.handleChangePassword,
    );
  }
}

export const authRouter = new AuthRouter().router;
