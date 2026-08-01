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
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.verifySignup,
      html: message,
    });
  },
  welcomeUser: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.welcomeUser,
      html: message,
    });
  },
  resetPassword: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.resetPassword,
      html: message,
    });
  },
  deleteAccountOtp: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.deleteAccountOtp,
      html: message,
    });
  },
  deleteAccountScheduled: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.deleteAccountScheduled,
      html: message,
    });
  },
  deleteAccountActivityCleared: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.deleteAccountActivityCleared,
      html: message,
    });
  },
  deleteAccountVendorNotice: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.deleteAccountVendorNotice,
      html: message,
    });
  },
  deleteAccountFinalized: (mailClient: MailClient, data: MailData) => {
    const { user, message } = data;
    return mailClient.sendMail({
      from: `"TheOtherWife" <${from}>`,
      to: user.email,
      subject: mailSubject.deleteAccountFinalized,
      html: message,
    });
  },
};
