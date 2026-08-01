/** @format */

import { resendApiKey, from } from "../constants/env.js";

import { MailerCallback } from "../dispatcher/mail.dispatcher.js";
import { UserDocument } from "../models/user.model.js";

const MailSubject = () => ({
  welcomeUser:
    "Welcome to TheOtherWife – Your Comfort Food Journey Starts Here!",
  verifySignup: "Verify Your Email",
  resetPassword: "Reset your password",
  deleteAccountOtp: "Confirm your account deletion request",
  deleteAccountScheduled: "Your account is scheduled for deletion",
  deleteAccountActivityCleared: "Your activity data has been cleared",
  deleteAccountVendorNotice: "Closing a vendor account",
  deleteAccountFinalized: "Your account has been deleted",
});

export const mailSubject = MailSubject();

export type MailData = {
  user: UserDocument;
  message: string;
};

class EmailService {
  private mailClient = {
    sendMail: async (payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }) => {
      if (!resendApiKey) {
        throw new Error("RESEND_API_KEY is not configured");
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Resend API error (${response.status}): ${errorBody}`);
      }

      return response.json();
    },
  };

  relayTo = async (data: MailData, callback: MailerCallback) => {
    try {
      return callback(this.mailClient, data);
    } catch (error) {
      throw error;
    }
  };

  // System/audit notifications with no associated User — bypasses the
  // relayTo/MailerCallback pattern above, which is coupled to a
  // UserDocument recipient.
  sendSystemAlert = async (to: string, subject: string, html: string) => {
    return this.mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to,
      subject,
      html,
    });
  };
}

export const mailer = new EmailService();
