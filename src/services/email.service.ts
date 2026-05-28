/** @format */

import { resendApiKey } from "../constants/env.js";

import { MailerCallback } from "../dispatcher/mail.dispatcher.js";
import { UserDocument } from "../models/user.model.js";

const MailSubject = () => ({
  welcomeUser:
    "Welcome to TheOtherWife – Your Comfort Food Journey Starts Here!",
  verifySignup: "Verify Your Email",
  resetPassword: "Reset your password",
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
}

export const mailer = new EmailService();
