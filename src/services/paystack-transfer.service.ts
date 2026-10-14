/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { InternalServerError } from "../errors/internal-server.error.js";
import { paystackBaseUrl, paystackSecretKey } from "../constants/env.js";

// Thin client for Paystack Transfers (paying vendors from TOW's Paystack
// balance). Server-side only: the secret key never leaves this process and is
// never logged; responses are reduced to the fields we use.

const REQUEST_TIMEOUT_MS = 15_000;

export type PaystackTransferState =
  | "success"
  | "pending"
  | "failed"
  | "reversed"
  | "otp"
  | "unknown";

export type PaystackTransferResult = {
  state: PaystackTransferState;
  rawStatus: string;
  reference?: string;
  transferCode?: string;
  amountKobo?: number;
  currency?: string;
  recipientCode?: string;
  reason?: string;
};

// Paystack's NGN transfer fee bands (approximate; Paystack's dashboard is
// authoritative). Used only to show the admin an estimate and to keep a
// small buffer in the balance check.
export const estimateTransferFee = (amountNaira: number): number => {
  if (amountNaira <= 5_000) return 10;
  if (amountNaira <= 50_000) return 25;
  return 50;
};

export class PaystackNetworkError extends Error {}

const mapTransferStatus = (status: string): PaystackTransferState => {
  switch (status) {
    case "success":
      return "success";
    case "failed":
    case "abandoned":
    case "rejected":
    case "blocked":
      return "failed";
    case "reversed":
      return "reversed";
    case "otp":
      return "otp";
    case "pending":
    case "received":
    case "processing":
    case "queued":
      return "pending";
    default:
      return "unknown";
  }
};

export class PaystackTransferService {
  private assertConfigured = () => {
    if (!paystackSecretKey) {
      throw new InternalServerError(
        "Paystack secret key is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }
  };

  // Network failures (timeout, connection reset) are surfaced as
  // PaystackNetworkError so callers can tell "Paystack said no" apart from
  // "we don't know what happened" — the latter must never be treated as a
  // failed transfer, because the money may have moved.
  private request = async <T>(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown } = {},
  ): Promise<{ ok: boolean; httpStatus: number; status: boolean; message: string; data?: T }> => {
    this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${paystackBaseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        status?: boolean;
        message?: string;
        data?: T;
      } | null;
      return {
        ok: response.ok,
        httpStatus: response.status,
        status: !!body?.status,
        message: typeof body?.message === "string" ? body.message : "",
        data: body?.data,
      };
    } catch (error: any) {
      throw new PaystackNetworkError(error?.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  };

  // The account holder's name as the bank reports it.
  resolveAccount = async (
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountName: string; accountNumber: string }> => {
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BadRequestException(
        "The account number must be 10 digits",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const result = await this.request<{ account_name?: string; account_number?: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    if (!result.ok || !result.status || !result.data?.account_name) {
      throw new BadRequestException(
        "The bank could not confirm this account number. Check the bank and account number.",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    return {
      accountName: result.data.account_name,
      accountNumber: result.data.account_number ?? accountNumber,
    };
  };

  createRecipient = async (input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<string> => {
    const result = await this.request<{ recipient_code?: string }>("/transferrecipient", {
      method: "POST",
      body: {
        type: "nuban",
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: "NGN",
      },
    });
    if (!result.ok || !result.status || !result.data?.recipient_code) {
      throw new BadRequestException(
        result.message || "Paystack could not register this bank account for payouts",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    return result.data.recipient_code;
  };

  // Available NGN balance in naira.
  getBalance = async (): Promise<number> => {
    const result = await this.request<{ currency?: string; balance?: number }[]>("/balance");
    if (!result.ok || !result.status || !Array.isArray(result.data)) {
      throw new BadRequestException(
        result.message || "Could not read the Paystack balance",
        HttpStatus.BAD_GATEWAY,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }
    const ngn = result.data.find((entry) => entry.currency === "NGN");
    return Math.round(Number(ngn?.balance ?? 0)) / 100;
  };

  initiateTransfer = async (input: {
    amountNaira: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<PaystackTransferResult> => {
    const result = await this.request<{
      status?: string;
      reference?: string;
      transfer_code?: string;
      amount?: number;
      currency?: string;
    }>("/transfer", {
      method: "POST",
      body: {
        source: "balance",
        amount: Math.round(input.amountNaira * 100),
        currency: "NGN",
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason.slice(0, 100),
      },
    });

    if (!result.ok || !result.status || !result.data) {
      // Paystack refused it outright (e.g. insufficient balance, transfers
      // not enabled): nothing was sent.
      return {
        state: "failed",
        rawStatus: "rejected",
        reference: input.reference,
        reason: result.message || `Paystack refused the transfer (HTTP ${result.httpStatus})`,
      };
    }

    const rawStatus = String(result.data.status ?? "");
    return {
      state: mapTransferStatus(rawStatus),
      rawStatus,
      reference: result.data.reference ?? input.reference,
      transferCode: result.data.transfer_code,
      amountKobo: result.data.amount,
      currency: result.data.currency,
      recipientCode: input.recipientCode,
    };
  };

  // Paystack's own record of a transfer, by our reference. `null` = Paystack
  // has no transfer with this reference.
  verifyTransfer = async (reference: string): Promise<PaystackTransferResult | null> => {
    const result = await this.request<{
      status?: string;
      reference?: string;
      transfer_code?: string;
      amount?: number;
      currency?: string;
      reason?: string;
      recipient?: { recipient_code?: string };
    }>(`/transfer/verify/${encodeURIComponent(reference)}`);

    if (!result.ok || !result.status || !result.data) {
      if (result.httpStatus === 404 || /not found/i.test(result.message)) return null;
      throw new PaystackNetworkError(`paystack_http_${result.httpStatus}`);
    }

    const rawStatus = String(result.data.status ?? "");
    return {
      state: mapTransferStatus(rawStatus),
      rawStatus,
      reference: result.data.reference,
      transferCode: result.data.transfer_code,
      amountKobo: result.data.amount,
      currency: result.data.currency,
      recipientCode: result.data.recipient?.recipient_code,
      reason: result.data.reason,
    };
  };
}

export const paystackTransferService = new PaystackTransferService();
