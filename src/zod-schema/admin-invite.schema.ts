/** @format */

import { z } from "zod";
import { emailSchema, phoneNumberSchema } from "./auth.schema.js";

/** Super admin invites a person. No password: the invitee chooses their own. */
export const inviteAdminSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: emailSchema,
  phoneNumber: phoneNumberSchema,
  adminRole: z.enum(["super_admin", "manager", "support_agent"]),
});

const token = z.string().trim().min(20).max(100);

export const checkAdminInviteSchema = z.strictObject({ token });

/** The strength rules live in admin-invite.service.ts (passwordProblem) so the message is specific. */
export const acceptAdminInviteSchema = z
  .strictObject({
    token,
    password: z.string().min(1).max(128),
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
