/** @format */

import type { Request, Response } from "express";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { UserService } from "../services/user.service.js";
import { AuthService } from "../services/auth.service.js";
import { HttpStatus } from "../config/http.config.js";
import { ApiResponse } from "../util/response.util.js";
import { nodeEnv } from "../constants/env.js";
import { logAdminAction } from "../util/audit-log.util.js";

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
    async (req: Request, res: Response): Promise<Response> => {
      const { search, group, status, page, limit } = req.query;
      const result = await this.userService.getAllCustomers({
        search: search as string | undefined,
        group: group as string | undefined,
        status: status as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        data: result,
        status: "ok",
        message: "Customers fetched successfully",
      } as ApiResponse);
    },
  );

  assignCustomerGroup = handleAsyncControl(
    async (
      req: Request<{ userId: string }, {}, { group: string }>,
      res: Response,
    ): Promise<Response> => {
      const { userId } = req.params;
      const { group } = req.body;
      const adminUserId = req.user?._id as unknown as string;

      const result = await this.userService.assignCustomerGroup(
        userId,
        group,
      );

      logAdminAction({
        adminUserId,
        action: "customer.group_assign",
        targetType: "Customer",
        targetId: userId,
        metadata: { group: result.group },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        data: result,
        status: "ok",
        message: "Customer group updated successfully",
      } as ApiResponse);
    },
  );

  updateCustomerNotes = handleAsyncControl(
    async (
      req: Request<{ userId: string }, {}, { adminNotes: string }>,
      res: Response,
    ): Promise<Response> => {
      const { userId } = req.params;
      const { adminNotes } = req.body;
      const adminUserId = req.user?._id as unknown as string;

      const result = await this.userService.updateCustomerAdminNotes(
        userId,
        adminNotes,
      );

      logAdminAction({
        adminUserId,
        action: "customer.notes_update",
        targetType: "Customer",
        targetId: userId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        data: result,
        status: "ok",
        message: "Customer notes updated successfully",
      } as ApiResponse);
    },
  );

  resetCustomerPassword = handleAsyncControl(
    async (
      req: Request<{ userId: string }>,
      res: Response,
    ): Promise<Response> => {
      const { userId } = req.params;
      const adminUserId = req.user?._id as unknown as string;

      const email = await this.userService.getCustomerForPasswordReset(
        userId,
      );
      await this.authService.forgotPassword(email);

      logAdminAction({
        adminUserId,
        action: "customer.reset_password",
        targetType: "User",
        targetId: userId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        data: null,
        status: "ok",
        message: "Password reset email sent to customer",
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

  getUserDirectoryForAdmin = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { search, type, status, page, limit } = req.query;
      const result = await this.userService.getUserDirectoryForAdmin({
        search: search as string | undefined,
        type: type as "customer" | "vendor" | undefined,
        status: status as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        data: result,
        status: "ok",
        message: "User directory fetched successfully",
      } as ApiResponse);
    },
  );

  getUserDetailsForAdmin = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const result = await this.userService.getUserDetailsForAdmin(
        req.params.id,
      );
      return res.status(HttpStatus.OK).json({
        data: result,
        status: "ok",
        message: "User details fetched successfully",
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
      req: Request<
        { userId: string },
        {},
        { status: "active" | "suspended" | "deleted"; reason?: string }
      >,
      res: Response,
    ): Promise<Response> => {
      const { userId } = req.params;
      const { status, reason } = req.body;
      const adminUserId = req.user?._id as unknown as string;

      const user = await this.userService.updateUserStatus(
        userId,
        status,
        reason,
      );

      logAdminAction({
        adminUserId,
        action: "user.status_update",
        targetType: "User",
        targetId: userId,
        metadata: { status, reason },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

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
      const creatingAdminId = req.user?._id as unknown as string;

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

      logAdminAction({
        adminUserId: creatingAdminId,
        action: "admin.create",
        targetType: "User",
        targetId: (userWithoutPassword as any)?._id?.toString(),
        metadata: { email },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
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
    async (req: Request, res: Response): Promise<Response> => {
      const period = req.query.period as
        | "today"
        | "week"
        | "month"
        | "all"
        | undefined;
      const analytics = await this.userService.getAdminOrderAnalytics(period);
      return res.status(HttpStatus.OK).json({
        data: analytics,
        status: "ok",
        message: "Admin order analytics fetched successfully",
      } as ApiResponse);
    },
  );
}
