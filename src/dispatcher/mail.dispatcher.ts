/** @format */

import { MailData } from "../services/email.service.js";
import { mailSubject } from "../services/email.service.js";
import { from } from "../constants/env.js";

export type MailClient = {
  sendMail: (payload: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }) => Promise<any>;
};
export type MailerCallback = (mailClient: MailClient, data: MailData) => void;

export const MailAction: Record<string, MailerCallback> = {
  verifySignup: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"Peace from TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.verifySignup,
      html: message,
    });
  },
  welcomeUser: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"Peace from TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.welcomeUser,
      html: message,
    });
  },
  resetPassword: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"Peace from TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.resetPassword,
      html: message,
    });
  },
};
