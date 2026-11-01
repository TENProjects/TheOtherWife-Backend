/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import User from "../models/user.model.js";
import { adminInviteService } from "../services/admin-invite.service.js";
import { logAdminAction } from "../util/audit-log.util.js";
import { ApiResponse } from "../util/response.util.js";

/** The signed-in super admin, with their name read from the database for the email. */
const inviterOf = async (req: Request) => {
  const id = String(req.user?._id);
  const me = await User.findById(id).select("firstName lastName").lean();
  return { id, name: [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "A TheOtherWife super admin" };
};

export class AdminInviteController {
  /** POST /users/admins/invite (super_admin). */
  invite = handleAsyncControl(async (req: Request, res: Response): Promise<Response> => {
    const inviter = await inviterOf(req);
    const result = await adminInviteService.invite(req.body, inviter);
    logAdminAction({
      adminUserId: inviter.id,
      action: "admin.invite",
      targetType: "User",
      targetId: result.userId,
      metadata: { email: result.email, adminRole: result.adminRole, emailSent: result.emailSent },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return res.status(HttpStatus.CREATED).json({
      status: "ok",
      message: result.emailSent
        ? `Invitation sent to ${result.email}`
        : `Admin created, but the invitation email to ${result.email} could not be sent. Use "Resend invite".`,
      data: result,
    } as ApiResponse);
  });

  /** POST /users/admins/:userId/resend-invite (super_admin). */
  resend = handleAsyncControl(async (req: Request<{ userId: string }>, res: Response): Promise<Response> => {
    const inviter = await inviterOf(req);
    const result = await adminInviteService.resend(req.params.userId, inviter);
    logAdminAction({
      adminUserId: inviter.id,
      action: "admin.invite_resend",
      targetType: "User",
      targetId: req.params.userId,
      metadata: { email: result.email, emailSent: result.emailSent },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: result.emailSent ? `New invitation sent to ${result.email}` : `The invitation email to ${result.email} could not be sent`,
      data: result,
    } as ApiResponse);
  });

  /** POST /auth/admin-invite/check (public, rate limited). */
  check = handleAsyncControl(async (req: Request, res: Response): Promise<Response> => {
    const data = await adminInviteService.check(req.body.token);
    return res.status(HttpStatus.OK).json({ status: "ok", message: "Invitation is valid", data } as ApiResponse);
  });

  /** POST /auth/admin-invite/accept (public, rate limited). */
  accept = handleAsyncControl(async (req: Request, res: Response): Promise<Response> => {
    const { email } = await adminInviteService.accept(req.body.token, req.body.password);
    return res.status(HttpStatus.OK).json({
      status: "ok",
      message: "Your admin account is active. You can now sign in.",
      data: { email },
    } as ApiResponse);
  });
}
