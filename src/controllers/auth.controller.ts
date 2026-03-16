/** @format */

import { AuthService } from "../services/auth.service.js";

import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";

import type { NextFunction, Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";

import { nodeEnv } from "../constants/env.js";
import { ApiResponse } from "../util/response.util.js";
import { CreateProfile } from "../dispatcher/profile.dispatcher.js";

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
          phoneNumber: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const { firstName, lastName, email, password, userType, phoneNumber } =
        req.body;

      try {
        const handleSignup = this.authService.signup([
          userType as keyof typeof CreateProfile,
        ]);

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
      req: Request<{}, {}, { token: string }>,
      res: Response,
    ): Promise<any> => {
      const emailToken = req.query.emailToken as string;
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
        throw error;
      }
    },
  );

  handleLogin = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        { phoneNumber?: string; email?: string; password: string }
      >,
      res: Response,
    ): Promise<any> => {
      const { phoneNumber, email, password } = req.body;

      try {
        const { accessToken, refreshToken, ...userWithoutPassword } =
          await this.authService.login({
            phoneNumber,
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

  handleDeleteUser = handleAsyncControl(
    async (req: Request, res: Response): Promise<any> => {
      const { email } = req.body;
      console.log(req.body.email);
      await this.authService.deleteUser(email);
      return res.status(200).json({
        success: true,
        message: `User with email ${email} has been deleted.`,
      });
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
