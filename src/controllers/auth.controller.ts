/** @format */

import { AuthService } from "../services/auth.service.js";

import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";

import { nodeEnv } from "../constants/env.js";
import { ApiResponse } from "../util/response.util.js";

export class AuthController {
  authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  handleSignup = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          firstName: string;
          lastName: string;
          email: string;
          password: string;
          userType: string;
          phoneNumber?: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const { firstName, lastName, email, password, userType, phoneNumber } =
        req.body;

      try {
        const handleSignup = this.authService.signup(["customer", "vendor"]);

        const { accessToken, refreshToken, ...userWithoutPassword } =
          await handleSignup({
            firstName,
            lastName,
            email,
            password,
            userType,
            phoneNumber,
          });

        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "User registered successfully",
          data: { accessToken, refreshToken, userWithoutPassword },
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  verifySignup = handleAsyncControl(
    async (
      req: Request<{}, {}, {}, { token: string }>,
      res: Response,
    ): Promise<any> => {
      const emailToken = req.query.token as string;
      console.log(`Received verification request for token: ${emailToken}`);
      try {
        const userWithoutPassword =
          await this.authService.verifySignup(emailToken);

        return res.status(HttpStatus.OK).json({
          status: "ok",
          message: "Email verified successfully",
          data: {
            userWithoutPassword,
          },
        } as ApiResponse);
      } catch (error) {
        console.error("Error in verifySignup controller:", error);
        throw error;
      }
    },
  );

  handleLogin = handleAsyncControl(
    async (
      req: Request<{}, {}, { email: string; password: string }>,
      res: Response,
    ): Promise<any> => {
      const { email, password } = req.body;

      try {
        const { accessToken, refreshToken, ...userWithoutPassword } =
          await this.authService.login({
            email,
            password,
          });

        return res
          .cookie("token", accessToken, {
            httpOnly: true,
            sameSite: "strict",
            secure: nodeEnv === "production",
          })
          .status(HttpStatus.OK)
          .json({
            status: "ok",
            message: "User login successful",
            data: {
              accessToken,
              refreshToken,
              userWithoutPassword,
            },
          } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  handleRefreshLogin = handleAsyncControl(
    async (
      req: Request<{}, {}, { refreshToken: string }>,
      res: Response,
    ): Promise<any> => {
      const oldRefreshToken = req.body.refreshToken;

      try {
        const {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          ...userWithoutPassword
        } = await this.authService.refreshLogin(oldRefreshToken);

        return res
          .cookie("token", newAccessToken, {
            httpOnly: true,
            sameSite: "strict",
            secure: nodeEnv === "production",
          })
          .status(HttpStatus.OK)
          .json({
            status: "ok",
            message: "Login refreshed successfully",
            data: {
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              userWithoutPassword,
            },
          } as ApiResponse);
      } catch (error) {
        res.clearCookie("token");
        res.clearCookie("refreshToken");
        throw error;
      }
    },
  );

  handleGoogleLogin = handleAsyncControl(
    async (
      req: Request<{}, {}, { idToken: string }>,
      res: Response,
    ): Promise<Response> => {
      const { idToken } = req.body;
      const { accessToken, refreshToken, ...userWithoutPassword } =
        await this.authService.googleLogin(idToken);

      return res
        .cookie("token", accessToken, {
          httpOnly: true,
          sameSite: "strict",
          secure: nodeEnv === "production",
        })
        .status(HttpStatus.OK)
        .json({
          status: "ok",
          message: "Google login successful",
          data: {
            accessToken,
            refreshToken,
            userWithoutPassword,
          },
        } as ApiResponse);
    },
  );

  handleLogout = handleAsyncControl(
    async (req: Request, res: Response): Promise<any> => {
      const userId = req?.user?._id as unknown as string;
      try {
        const cookieOptions = await this.authService.logout(userId);
        res.clearCookie("token", cookieOptions);
        res.clearCookie("refreshToken");
        return res.status(HttpStatus.NO_CONTENT).send();
      } catch (error) {
        throw error;
      }
    },
  );

  handleForgotPassword = handleAsyncControl(
    async (
      req: Request<{}, {}, { email: string }>,
      res: Response,
    ): Promise<Response> => {
      await this.authService.forgotPassword(req.body.email);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message:
          "If an account with this email exists, a password reset link has been sent",
      } as ApiResponse);
    },
  );

  handleResetPassword = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { token: string; newPassword: string; confirmNewPassword: string }
      >,
      res: Response,
    ): Promise<Response> => {
      await this.authService.resetPassword({
        token: req.body.token,
        newPassword: req.body.newPassword,
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Password reset successful",
      } as ApiResponse);
    },
  );

  handleChangePassword = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          currentPassword: string;
          newPassword: string;
          confirmNewPassword: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      await this.authService.changePassword({
        userId,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Password changed successfully",
      } as ApiResponse);
    },
  );
}

// passwordResetRequest = handleAsyncControl(
//   async (
//     req: Request<{}, {}, { phoneNumber: string }>,
//     res: Response,
//   ): Promise<any> => {
//     try {
//       const { token } = await this.authService.passwordResetRequest(
//         req.body.phoneNumber,
//       );
//       return res
//         .status(HttpStatus.OK)
//         .json({ status: "ok", message: "User login successful" });
//     } catch (error) {
//       throw error;
//     }
//   },
// );

// passwordReset = handleAsyncControl(
//   async (
//     req: Request<{}, {}, { phoneNumber: string; token: string }>,
//     res: Response,
//   ): Promise<any> => {
//     try {
//       await this.authService.passwordReset(
//         req.body.phoneNumber,
//         req.body.token,
//       );
//       return res
//         .status(HttpStatus.OK)
//         .json({ status: "ok", message: "User login successful" });
//     } catch (error) {
//       throw error;
//     }
//   },
// );
