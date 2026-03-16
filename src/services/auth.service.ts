/** @format */

import { ClientSession } from "mongoose";

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
  generateOtp,
} from "../util/generate-token.util.js";
import { jwtRefreshSecret, nodeEnv } from "../constants/env.js";
import { transaction } from "../util/transaction.util.js";
import { CreateProfile } from "../dispatcher/profile.dispatcher.js";
import { MailData, mailer } from "./email.service.js";
import { getTemplate } from "../util/convert-template.util.js";
import { MailAction } from "../dispatcher/mail.dispatcher.js";
import { getFormattedData } from "../util/get-maildata.js";

export class AuthService {
  constructor() {}

  signup =
    (allowedTypes: Array<keyof typeof CreateProfile>) =>
    async (body: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      userType: string;
      phoneNumber: string;
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
          let numOfAttempt = 0;
          const maxNumOfAttempt = 3;

          setImmediate(async () => {
            const enableRetry = async () => {
              try {
                console.log(Object.freeze(userWithoutPassword));

                const htmlTemplate = await getTemplate(
                  "src/templates",
                  "verify-signup.templates.html",
                );

                const { template } = getFormattedData(
                  htmlTemplate,
                  userWithoutPassword,
                );

                const html = template.replaceAll(
                  "{{verificationUrl}}",
                  `https://the-other-wife.vercel.app/api/v1/auth/verify?emailToken=${userWithoutPassword.emailToken}`,
                );

                const data = {
                  user: userWithoutPassword,
                  message: html,
                };

                const info = await mailer.relayTo(
                  data,
                  MailAction.verifySignup,
                );

                console.log(`Verify Email sent successfully: ${info}`);
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

  verifySignup = async (emailToken: string) => {
    return await transaction
      .use(async (session: ClientSession, emailToken: string): Promise<any> => {
        try {
          let user = await User.findOne({
            emailToken,
            emailTokenExpiry: { $gt: new Date() },
          }).session(session);

          if (!user) {
            throw new NotFoundException(
              "User not found",
              HttpStatus.NOT_FOUND,
              ErrorCode.AUTH_USER_NOT_FOUND,
            );
          }

          user.isEmailVerified = true;
          user.emailToken = "";
          user.emailTokenExpiry = new Date(Date.now() - 1000);
          user.lastLogin = new Date();
          await user.save({ session });

          const userWithoutPassword = user?.omitPassword();

          return {
            ...userWithoutPassword,
          };
        } catch (error) {
          throw error;
        }
      })(emailToken)
      .then((result) => {
        let numOfAttempt = 0;
        const maxNumOfAttempt = 3;

        setImmediate(async () => {
          const enableRetry = async () => {
            try {
              console.log(Object.freeze(result));

              const htmlTemplate = await getTemplate(
                "src/templates",
                "welcome-email.templates.html",
              );

              const { template } = getFormattedData(htmlTemplate, result);

              const data = {
                user: result,
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
        phoneNumber?: string;
        email?: string;
        password: string;
      },
    ): Promise<any> => {
      const { phoneNumber, email, password } = body;

      try {
        let user = await User.findOne(
          email ? { email } : { phoneNumber },
        ).session(session);

        if (!user) {
          throw new NotFoundException(
            `Incorrect ${email ? "email" : "phone number"}`,
            HttpStatus.NOT_FOUND,
            ErrorCode.AUTH_USER_NOT_FOUND,
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
          ...user?.omitPassword(),
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
            throw new NotFoundException(
              "User not found",
              HttpStatus.NOT_FOUND,
              ErrorCode.AUTH_USER_NOT_FOUND,
            );
          }

          const { otp, otpExpiry } = generateOtp();
          user.otp = otp;
          user.otpExpiry = otpExpiry;
          await user.save({ session });

          return { otp };
        } catch (error) {
          throw error;
        }
      })(email)
      .then((result) => {
        let numOfAttempt = 0;
        const maxNumOfAttempt = 3;

        setImmediate(async () => {
          const enableRetry = async () => {
            try {
              console.log(Object.freeze(result));

              const htmlTemplate = await getTemplate(
                "src/templates",
                "welcome-email.templates.html",
              );

              const { template } = getFormattedData(htmlTemplate);

              const data = {
                user: result,
                message: template,
              } as MailData;

              const info = await mailer.relayTo(data, MailAction.welcome);

              console.log(`Email sent successfully: ${info}`);
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

  deleteUser = async (email: string) => {
    const deletedUser = await User.findOneAndDelete({ email });
    if (!deletedUser) {
      console.log("No user found with that email.");
      throw new Error("No user found!");
    }
    return deletedUser;
  };
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
