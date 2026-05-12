/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { UserService } from "../services/user.service.js";
import { AuthService } from "../services/auth.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { nodeEnv } from "../constants/env.js";

export class UserController {
  userService: UserService;
  authService: AuthService;

  constructor() {
    this.userService = new UserService();
    this.authService = new AuthService();
  }

  getCurrentUser = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const userId = req?.user?._id as unknown as string;
      try {
        const user = await this.userService.getCurrentUser(userId);
        return res.status(HttpStatus.OK).json({
          data: user,
          status: "ok",
          message: "User fetched successfully",
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  getAllUsers = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      try {
        const users = await this.userService.getAllUsers();
        return res.status(HttpStatus.OK).json({
          data: users,
          status: "ok",
          message: "Users fetched successfully",
        } as ApiResponse);
      } catch (error) {
        throw error;
      }
    },
  );

  getAllCustomers = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const customers = await this.userService.getAllCustomers();
      return res.status(HttpStatus.OK).json({
        data: customers,
        status: "ok",
        message: "Customers fetched successfully",
      } as ApiResponse);
    },
  );

  getAllVendors = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const vendors = await this.userService.getAllVendors();
      return res.status(HttpStatus.OK).json({
        data: vendors,
        status: "ok",
        message: "Vendors fetched successfully",
      } as ApiResponse);
    },
  );

  closeCurrentUserAccount = handleAsyncControl(
    async (
      req: Request<{}, {}, { password: string }>,
      res: Response,
    ): Promise<Response> => {
      const userId = req.user?._id as unknown as string;
      const { password } = req.body;

      await this.userService.closeCurrentUserAccount(userId, password);

      res.clearCookie("token", {
        httpOnly: true,
        sameSite: "strict",
        secure: nodeEnv === "production",
        path: "/",
        expires: new Date(0),
      });
      res.clearCookie("refreshToken");

      return res.status(HttpStatus.NO_CONTENT).send();
    },
  );

  updateUserStatus = handleAsyncControl(
    async (
      req: Request<{ userId: string }, {}, { status: "active" | "suspended" | "deleted" }>,
      res: Response,
    ): Promise<Response> => {
      const { userId } = req.params;
      const { status } = req.body;

      const user = await this.userService.updateUserStatus(userId, status);

      return res.status(HttpStatus.OK).json({
        data: user,
        status: "ok",
        message: "User status updated successfully",
      } as ApiResponse);
    },
  );

  createAdminUser = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          firstName: string;
          lastName: string;
          email: string;
          password: string;
          phoneNumber: string;
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const { firstName, lastName, email, password, phoneNumber } = req.body;

      const handleSignup = this.authService.signup(["admin"]);
      const { accessToken, refreshToken, ...userWithoutPassword } =
        await handleSignup({
          firstName,
          lastName,
          email,
          password,
          userType: "admin",
          phoneNumber,
        });

      return res.status(HttpStatus.CREATED).json({
        data: { accessToken, refreshToken, userWithoutPassword },
        status: "ok",
        message: "Admin user created successfully",
      } as ApiResponse);
    },
  );

  getAdminAnalytics = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const analytics = await this.userService.getAdminAnalytics();
      return res.status(HttpStatus.OK).json({
        data: analytics,
        status: "ok",
        message: "Admin analytics fetched successfully",
      } as ApiResponse);
    },
  );

  getAdminOrderAnalytics = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const analytics = await this.userService.getAdminOrderAnalytics();
      return res.status(HttpStatus.OK).json({
        data: analytics,
        status: "ok",
        message: "Admin order analytics fetched successfully",
      } as ApiResponse);
    },
  );
}
