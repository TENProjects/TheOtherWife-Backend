/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import bcrypt from "bcrypt";

export interface UserDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  phoneNumber?: string;
  emailToken: string;
  emailTokenExpiry: Date;
  otp: string;
  otpExpiry: Date;
  resetPasswordTokenHash: string;
  resetPasswordExpiresAt: Date;
  passwordChangedAt: Date;
  refreshToken: string;
  refreshTokenExpiry: Date;
  status: string;
  // Admin-provided reason for the current status, captured on suspend/delete.
  // Cleared when the account is reactivated.
  statusReason?: string;
  userType: string;
  authType: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLogin: Date;
  // Outcome tracking for each of the three emails auth.service.ts sends —
  // previously invisible (console.error only); now queryable, e.g.
  // User.find({ verificationEmailStatus: "failed" }).
  verificationEmailStatus?: "pending" | "sent" | "failed";
  verificationEmailLastAttemptAt?: Date;
  verificationEmailError?: string;
  welcomeEmailStatus?: "pending" | "sent" | "failed";
  welcomeEmailLastAttemptAt?: Date;
  welcomeEmailError?: string;
  passwordResetEmailStatus?: "pending" | "sent" | "failed";
  passwordResetEmailLastAttemptAt?: Date;
  passwordResetEmailError?: string;
  comparePassword: (password: string) => Promise<boolean>;
  omitPassword: () => Omit<UserDocument, "password">;
}

const UserSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    emailToken: {
      type: String,
      required: false,
    },
    emailTokenExpiry: {
      type: Date,
      required: false,
    },
    refreshToken: {
      type: String,
      required: false,
    },
    resetPasswordTokenHash: {
      type: String,
      required: false,
    },
    resetPasswordExpiresAt: {
      type: Date,
      required: false,
    },
    passwordChangedAt: {
      type: Date,
      required: false,
    },
    refreshTokenExpiry: {
      type: Date,
      required: false,
      default: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
    status: {
      type: String,
      enum: ["active", "suspended", "deleted"],
      default: "active",
    },
    statusReason: {
      type: String,
      required: false,
    },
    userType: {
      type: String,
      required: true,
      enum: ["customer", "vendor", "admin"],
    },
    authType: {
      type: String,
      enum: ["email", "google", "phoneNumber"],
      default: "email",
    },
    isEmailVerified: {
      type: Boolean,
      required: false,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      required: false,
      default: false,
    },
    lastLogin: {
      type: Date,
      required: false,
    },
    verificationEmailStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    verificationEmailLastAttemptAt: {
      type: Date,
      required: false,
    },
    verificationEmailError: {
      type: String,
      required: false,
    },
    welcomeEmailStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    welcomeEmailLastAttemptAt: {
      type: Date,
      required: false,
    },
    welcomeEmailError: {
      type: String,
      required: false,
    },
    passwordResetEmailStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    passwordResetEmailLastAttemptAt: {
      type: Date,
      required: false,
    },
    passwordResetEmailError: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.pre("save", async function (next) {
  if (this.isModified("passwordHash")) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
      return next();
    } catch (error) {
      console.error("Error hashing password:", error);
      return next(error as Error);
    }
  }
  next();
});

UserSchema.methods.comparePassword = async function (
  passwordHash: string,
): Promise<boolean> {
  return await bcrypt.compare(passwordHash, this.passwordHash);
};

UserSchema.methods.omitPassword = function (): Omit<
  UserDocument,
  "passwordHash"
> {
  const { passwordHash, ...user } = this.toObject();
  return user;
};

export default model<UserDocument>("User", UserSchema);
