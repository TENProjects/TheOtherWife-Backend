/** @format */

import { ClientSession } from "mongoose";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { UnauthorizedExceptionError } from "../errors/unauthorized-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import User, { UserDocument } from "../models/user.model.js";

import {
  generateToken,
  generateRefreshToken,
  verifyToken,
  generateEmailToken,
} from "../util/generate-token.util.js";
import {
  frontendUrl,
  googleClientId,
  googleAudiences,
  jwtRefreshSecret,
  nodeEnv,
  resetPasswordTokenTtlMinutes,
} from "../constants/env.js";
import { transaction } from "../util/transaction.util.js";
import { CreateProfile } from "../dispatcher/profile.dispatcher.js";
import { MailData, mailer } from "./email.service.js";
import { getTemplate } from "../util/get-template.util.js";
import { MailAction } from "../dispatcher/mail.dispatcher.js";
import { getFormattedData } from "../util/get-maildata.js";

export class AuthService {
  constructor() {}
  private googleOauthClient = new OAuth2Client(googleClientId);

  private sendVerificationEmail = async (user: any) => {
    let numOfAttempt = 0;
    const maxNumOfAttempt = 3;

    const enableRetry = async (): Promise<void> => {
      try {
        const htmlTemplate = await getTemplate(
          "src/templates",
          "verify-signup.template.html",
        );

        const { template } = getFormattedData(htmlTemplate, user);
        const baseHost = frontendUrl.endsWith("/")
          ? frontendUrl.slice(0, -1)
          : frontendUrl;
        const html = template.replaceAll(
          "{{verificationUrl}}",
          `${baseHost}/api/v1/auth/verify?token=${user.emailToken}`,
        );

        const data = {
          user,
          message: html,
        };

        await mailer.relayTo(data as MailData, MailAction.verifySignup);
      } catch (error) {
        numOfAttempt++;
        if (numOfAttempt <= maxNumOfAttempt) {
          await new Promise((res) => setTimeout(res, 1000));
          return enableRetry();
        }
        console.error(error);
      }
    };

    await enableRetry();
  };

  signup =
    (allowedTypes: Array<keyof typeof CreateProfile>) =>
    async (body: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      userType: string;
      phoneNumber?: string;
    }) => {
      return await transaction
        .use(async (session: ClientSession, body): Promise<any> => {
          const {
            firstName,
            lastName,
            password,
            userType,
            phoneNumber,
            email,
          } = body;

          if (!allowedTypes.includes(userType as keyof typeof CreateProfile)) {
            throw new BadRequestException(
              `User type ${userType} is not supported`,
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            );
          }

          try {
            const existingUser = await User.findOne({
              $or: [
                { ...(email && { email }) },
                { ...(phoneNumber && { phoneNumber }) },
              ],
            }).session(session);

            const authType = existingUser
              ? existingUser.email === email
                ? "email"
                : existingUser.phoneNumber === phoneNumber
                  ? "phone number"
                  : null
              : null;

            authType &&
              (() => {
                throw new BadRequestException(
                  `${authType} already exists`,
                  HttpStatus.BAD_REQUEST,
                  authType === "email"
                    ? ErrorCode.AUTH_EMAIL_ALREADY_EXISTS
                    : ErrorCode.AUTH_PHONE_NUMBER_ALREADY_EXISTS,
                );
              })();

            const [newUser] = await User.create(
              [
                {
                  firstName,
                  lastName,
                  email,
                  passwordHash: password,
                  userType,
                  phoneNumber,
                },
              ],
              { session },
            );

            await CreateProfile[userType as keyof typeof CreateProfile](
              newUser._id as unknown as string,
              session,
            );

            const { token: accessToken } = generateToken(newUser);
            const { refreshToken } = generateRefreshToken(newUser);
            const { emailToken, emailTokenExpiry } = generateEmailToken();

            newUser.refreshToken = refreshToken;
            newUser.refreshTokenExpiry = new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            );
            newUser.emailToken = emailToken;
            newUser.emailTokenExpiry = emailTokenExpiry;
            await newUser.save({ session });

            return {
              accessToken,
              refreshToken,
              ...(newUser.omitPassword() as any),
            };
          } catch (error) {
            throw error;
          }
        })(body)
        .then((result) => {
          const { accessToken, refreshToken, ...userWithoutPassword } = result;

          setImmediate(async () => {
            await this.sendVerificationEmail(userWithoutPassword);
          });

          return result;
        });
    };

  verifySignup = async (emailToken: string) => {
    return await transaction
      .use(async (session: ClientSession, emailToken: string): Promise<any> => {
        try {
          console.log(`Verifying signup with token: ${emailToken}`);
          let user = await User.findOne({ emailToken }).session(session);

          if (!user) {
            throw new NotFoundException(
              "Invalid verification link",
              HttpStatus.NOT_FOUND,
              ErrorCode.AUTH_INVALID_TOKEN,
            );
          }

          if (user.isEmailVerified) {
            return user.omitPassword();
          }

          if (!user.emailTokenExpiry || user.emailTokenExpiry <= new Date()) {
            const { emailToken: nextToken, emailTokenExpiry } = generateEmailToken();
            user.emailToken = nextToken;
            user.emailTokenExpiry = emailTokenExpiry;
            await user.save({ session });

            const userWithoutPassword = user.omitPassword();
            setImmediate(async () => {
              await this.sendVerificationEmail(userWithoutPassword);
            });

            throw new BadRequestException(
              "Verification link expired. A new verification email has been sent.",
              HttpStatus.BAD_REQUEST,
              ErrorCode.AUTH_VERIFICATION_LINK_EXPIRED,
            );
          }

          console.log(`User found for token: ${user.email}`);
          user.isEmailVerified = true;
          user.emailToken = "";
          user.emailTokenExpiry = new Date(Date.now() - 1000);
          user.lastLogin = new Date();
          await user.save({ session });

          const userWithoutPassword = user?.omitPassword();

          console.log("Verified user from DB:", userWithoutPassword);

          return {
            ...userWithoutPassword,
            email: user.email,
            firstName: user.firstName,
          };
        } catch (error) {
          console.error("Error in verifySignup service:", error);
          throw error;
        }
      })(emailToken)
      .then((result) => {
        const userWithoutPassword = result;
        console.log("Starting setImmediate for welcome email sending...");
        let numOfAttempt = 0;
        const maxNumOfAttempt = 3;

        setImmediate(async () => {
          const enableRetry = async () => {
            try {
              console.log("Verified user:", userWithoutPassword);

              const htmlTemplate = await getTemplate(
                "src/templates",
                "welcome-email.template.html",
              );

              const { template } = getFormattedData(
                htmlTemplate,
                userWithoutPassword,
              );

              const data = {
                user: userWithoutPassword,
                message: template,
              };

              const info = await mailer.relayTo(data, MailAction.welcomeUser);

              console.log(`Welcome Email sent successfully: ${info}`);
            } catch (error: any) {
              numOfAttempt++;
              if (numOfAttempt <= maxNumOfAttempt) {
                await new Promise((res) => setTimeout(res, 1000));
                return enableRetry();
              }

              console.error(error);
            }
          };

          await enableRetry();
        });
        return result;
      });
  };

  login = transaction.use(
    async (
      session: ClientSession,
      body: {
        email: string;
        password: string;
      },
    ): Promise<any> => {
      const { email, password } = body;

      try {
        let user = await User.findOne({ email }).session(session);

        if (!user) {
          throw new NotFoundException(
            "Incorrect email",
            HttpStatus.NOT_FOUND,
            ErrorCode.AUTH_USER_NOT_FOUND,
          );
        }

        if (!user.isEmailVerified) {
          throw new UnauthorizedExceptionError(
            "Account not verified. Please verify your email before logging in.",
            HttpStatus.UNAUTHORIZED,
            ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
          );
        }

        const isValid = await user.comparePassword(password);
        if (!isValid) {
          throw new UnauthorizedExceptionError(
            `Incorrect password`,
            HttpStatus.UNAUTHORIZED,
            ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
          );
        }

        const { token: accessToken } = generateToken(user);

        const { refreshToken } = generateRefreshToken(user);

        user = await User.findByIdAndUpdate(
          user._id,
          {
            $set: {
              lastLogin: new Date(),
              refreshToken,
              refreshTokenExpiry: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ),
            },
          },
          { new: true, session: session },
        );

        const userWithoutPassword = user?.omitPassword();

        return {
          accessToken,
          refreshToken,
          ...userWithoutPassword,
        };
      } catch (error) {
        throw error;
      }
    },
  );

  googleLogin = transaction.use(
    async (
      session: ClientSession,
      idToken: string,
    ): Promise<{
      accessToken: string;
      refreshToken: string;
      [key: string]: any;
    }> => {
      if (googleAudiences.length === 0) {
        throw new BadRequestException(
          "Google sign-in is not configured",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      // Each platform (web/Android/iOS) mints its id_token against its own
      // OAuth client, so all configured client ids must be allow-listed here.
      const ticket = await this.googleOauthClient.verifyIdToken({
        idToken,
        audience: googleAudiences,
      });

      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) {
        throw new UnauthorizedExceptionError(
          "Google account email is not verified",
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
        );
      }

      let user = await User.findOne({ email: payload.email }).session(session);
      if (!user) {
        const [newUser] = await User.create(
          [
            {
              firstName: payload.given_name || "Google",
              lastName: payload.family_name || "User",
              email: payload.email,
              passwordHash: crypto.randomBytes(32).toString("hex"),
              userType: "customer",
              authType: "google",
              isEmailVerified: true,
              emailToken: "",
              emailTokenExpiry: new Date(Date.now() - 1000),
            },
          ],
          { session },
        );

        await CreateProfile.customer(newUser._id as unknown as string, session);
        user = newUser;
      } else if (!user.isEmailVerified) {
        user.isEmailVerified = true;
        user.authType = user.authType || "google";
      }

      const { token: accessToken } = generateToken(user);
      const { refreshToken } = generateRefreshToken(user);

      user = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            lastLogin: new Date(),
            isEmailVerified: true,
            refreshToken,
            refreshTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
        { new: true, session },
      );

      return {
        accessToken,
        refreshToken,
        ...(user?.omitPassword() as any),
      };
    },
  );

  refreshLogin = transaction.use(
    async (session: ClientSession, refreshToken: string) => {
      try {
        if (!refreshToken) {
          throw new BadRequestException(
            "Refresh token is required",
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const decoded = verifyToken(refreshToken, jwtRefreshSecret);

        if (!decoded || typeof decoded === "string") {
          throw new UnauthorizedExceptionError(
            "Invalid token",
            HttpStatus.UNAUTHORIZED,
            ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
          );
        }

        let user = await User.findOne({
          _id: decoded._id,
          refreshToken,
          refreshTokenExpiry: { $gt: new Date() },
        }).session(session);

        if (!user) {
          throw new NotFoundException(
            "Session expired",
            HttpStatus.NOT_FOUND,
            ErrorCode.AUTH_INVALID_TOKEN,
          );
        }

        const { token: newAccessToken } = generateToken(user);
        const { refreshToken: newRefreshToken } = generateRefreshToken(user);
        user = await User.findByIdAndUpdate(
          user._id,
          {
            $set: {
              refreshToken: newRefreshToken,
              refreshTokenExpiry: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ),
            },
          },
          { new: true },
        ).session(session);

        return {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          ...(user?.omitPassword() as any),
        };
      } catch (error) {
        throw error;
      }
    },
  );

  logout = async (userId: string): Promise<any> => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    await User.findByIdAndUpdate(userId, {
      $unset: { refreshToken: 1, refreshTokenExpiry: 1 },
    });

    return {
      httpOnly: true,
      secure: nodeEnv === "production",
      sameSite: "strict",
      path: "/",
      expires: new Date(0),
    };
  };

  forgotPassword = async (email: string) => {
    return transaction
      .use(async (session: ClientSession, email: string) => {
        try {
          const user = await User.findOne({ email }).session(session);

          if (!user) {
            return null;
          }

          const rawToken = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");

          user.resetPasswordTokenHash = tokenHash;
          user.resetPasswordExpiresAt = new Date(
            Date.now() + resetPasswordTokenTtlMinutes * 60 * 1000,
          );
          await user.save({ session });

          return { user, rawToken };
        } catch (error) {
          throw error;
        }
      })(email)
      .then((result) => {
        if (!result) {
          return null;
        }

        let numOfAttempt = 0;
        const maxNumOfAttempt = 3;

        setImmediate(async () => {
          const enableRetry = async () => {
            try {
              const htmlTemplate = await getTemplate(
                "src/templates",
                "reset-password.template.html",
              );

              const { template } = getFormattedData(htmlTemplate, result.user);
              const resetUrl = `${frontendUrl}/reset-password?token=${result.rawToken}`;
              const html = template.replaceAll("{{resetUrl}}", resetUrl);

              const data = {
                user: result.user,
                message: html,
              } as MailData;

              const info = await mailer.relayTo(data, MailAction.resetPassword);

              console.log(`Password reset email sent successfully: ${info}`);
            } catch (error: any) {
              numOfAttempt++;
              if (numOfAttempt <= maxNumOfAttempt) {
                await new Promise((res) => setTimeout(res, 1000));
                return enableRetry();
              }

              console.error(error);
            }
          };

          await enableRetry();
        });
        return result;
      });
  };

  resetPassword = transaction.use(
    async (
      session: ClientSession,
      body: {
        token: string;
        newPassword: string;
      },
    ): Promise<void> => {
      const { token, newPassword } = body;
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const user = await User.findOne({
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { $gt: new Date() },
      }).session(session);

      if (!user) {
        throw new BadRequestException(
          "Invalid or expired reset token",
          HttpStatus.BAD_REQUEST,
          ErrorCode.AUTH_INVALID_TOKEN,
        );
      }

      const isCurrentPassword = await user.comparePassword(newPassword);
      if (isCurrentPassword) {
        throw new BadRequestException(
          "New password must be different from current password",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      user.passwordHash = newPassword;
      user.passwordChangedAt = new Date();
      user.resetPasswordTokenHash = "";
      user.resetPasswordExpiresAt = new Date(Date.now() - 1000);
      user.refreshToken = "";
      user.refreshTokenExpiry = new Date(Date.now() - 1000);
      await user.save({ session });
    },
  );

  changePassword = transaction.use(
    async (
      session: ClientSession,
      body: {
        userId: string;
        currentPassword: string;
        newPassword: string;
      },
    ): Promise<void> => {
      const { userId, currentPassword, newPassword } = body;
      const user = await User.findById(userId).session(session);

      if (!user) {
        throw new NotFoundException(
          "User not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.AUTH_USER_NOT_FOUND,
        );
      }

      const isValidCurrent = await user.comparePassword(currentPassword);
      if (!isValidCurrent) {
        throw new UnauthorizedExceptionError(
          "Current password is incorrect",
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_UNAUTHORIZED_ACCESS,
        );
      }

      const isSamePassword = await user.comparePassword(newPassword);
      if (isSamePassword) {
        throw new BadRequestException(
          "New password must be different from current password",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      user.passwordHash = newPassword;
      user.passwordChangedAt = new Date();
      user.refreshToken = "";
      user.refreshTokenExpiry = new Date(Date.now() - 1000);
      await user.save({ session });
    },
  );
}

// passwordReset = async (newPassword: string, token: string) => {
//   const user = await User.findOne({
//     resetToken: token,
//     resetTokenExpiry: { $gt: Date.now(), $lt: Date.now() + 20 * 60 * 1000 },
//   });
//   if (!user) {
//     throw new NotFoundException(
//       "User not found",
//       HttpStatus.NOT_FOUND,
//       ErrorCode.AUTH_USER_NOT_FOUND,
//     );
//   }

//   user.passwordHash = await bcrypt.hash(newPassword, 10);
//   user.resetToken = null;
//   user.resetTokenExpiry = null;
//   await user.save();
// };
