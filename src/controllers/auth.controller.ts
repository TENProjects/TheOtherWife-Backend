/** @format */

import { AuthService } from "../services/auth.service.js";

import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { ErrorCode } from "../enums/error-code.enum.js";

import { nodeEnv } from "../constants/env.js";
import { ApiResponse } from "../util/response.util.js";
import { getTemplate } from "../util/get-template.util.js";

// Renders the branded landing page a user sees after tapping the
// verify-signup email link — this is a browser-rendered page (not a JSON
// API response), so it needs to look like something a human should see.
const renderVerifyResultPage = async (options: {
  success: boolean;
  title: string;
  message: string;
}): Promise<string> => {
  const template = await getTemplate(
    "src/templates",
    "verify-result.template.html",
  );

  return template
    .replaceAll("{{title}}", options.title)
    .replaceAll("{{message}}", options.message)
    .replaceAll("{{icon}}", options.success ? "&#10003;" : "&#10005;")
    .replaceAll("{{iconBackground}}", options.success ? "#E6F8EC" : "#FDEAEA")
    .replaceAll("{{iconColor}}", options.success ? "#44C455" : "#E5484D");
};

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

  // Reached by a user tapping the link in their verify-signup email — a
  // browser hit, not the app calling an API, so it renders an HTML landing
  // page rather than a JSON response. Errors are handled locally (not
  // rethrown) so the global JSON error middleware never intercepts this
  // route and breaks the page.
  verifySignup = handleAsyncControl(
    async (
      req: Request<{}, {}, {}, { token: string }>,
      res: Response,
    ): Promise<Response> => {
      const emailToken = req.query.token;
      try {
        if (typeof emailToken !== "string" || !emailToken) {
          throw new BadRequestException(
            "Invalid or missing verification token",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const userWithoutPassword =
          await this.authService.verifySignup(emailToken);

        const html = await renderVerifyResultPage({
          success: true,
          title: "Email Verified!",
          message: `Thanks${userWithoutPassword?.firstName ? `, ${userWithoutPassword.firstName}` : ""}! Your email has been verified. You can now return to the TheOtherWife app.`,
        });

        return res.status(HttpStatus.OK).type("html").send(html);
      } catch (error: any) {
        console.error("Error in verifySignup controller:", error);

        const html = await renderVerifyResultPage({
          success: false,
          title: "Verification Failed",
          message:
            error?.message ||
            "This verification link is invalid or has expired.",
        });

        return res
          .status(error?.statusCode || HttpStatus.BAD_REQUEST)
          .type("html")
          .send(html);
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

  handleResendVerificationEmail = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      await this.authService.resendVerificationEmail(userId);

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Verification email sent successfully",
      } as ApiResponse);
    },
  );

  // Public counterpart of handleResendVerificationEmail above — for a user
  // with no valid session at all. Always responds with the same generic
  // message regardless of outcome, so the response itself can't leak
  // account existence or verification state either.
  handleResendVerificationEmailByEmail = handleAsyncControl(
    async (
      req: Request<{}, {}, { email: string }>,
      res: Response,
    ): Promise<Response> => {
      await this.authService.resendVerificationEmailByEmail(req.body.email);
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message:
          "If an account with this email exists and isn't verified yet, a new verification email has been sent",
      } as ApiResponse);
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
