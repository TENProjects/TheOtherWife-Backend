/** @format */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { jwtSecret, jwtRefreshSecret } from "../constants/env.js";
import { UserDocument } from "../models/user.model.js";

export const generateToken = (user: UserDocument) => {
  const payload = { _id: user._id, userType: user.userType };
  const token = jwt.sign(payload, jwtSecret, {
    expiresIn: "30m",
  });

  return { token };
};

export const generateRefreshToken = (user: UserDocument) => {
  const refreshToken = jwt.sign(
    { _id: user._id, userType: user.userType },
    jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );

  return { refreshToken };
};

export const generateEmailToken = () => ({
  emailToken: crypto.randomBytes(20).toString("hex"),
  emailTokenExpiry: new Date(Date.now() + 30 * 60 * 1000),
});

export const generateOtp = () => ({
  otp: Math.floor(1000 + Math.random() * 9000).toString(),
  otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
});

export const verifyToken = (token: string, secret: string) =>
  jwt.verify(token, secret);

// Access token for a user request. An `Authorization: Bearer <jwt>` header wins
// over the `token` cookie: native mobile clients send the header explicitly,
// while iOS's system cookie store can attach a stale `token` cookie or drop a
// hand-written Cookie header. Browsers (web, admin) send no Authorization
// header, so they keep using the cookie exactly as before. Partner API keys
// (tow_pk_…) are never treated as user tokens.
export const extractAccessToken = (req: {
  headers: { authorization?: string };
  cookies?: Record<string, string | undefined>;
}): string | undefined => {
  const match = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
  const bearer = match?.[1];
  if (bearer && !bearer.startsWith("tow_pk_")) return bearer;
  return req.cookies?.token || undefined;
};
