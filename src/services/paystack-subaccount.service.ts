/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { InternalServerError } from "../errors/internal-server.error.js";
import { paystackSecretKey, paystackBaseUrl } from "../constants/env.js";

type PaystackBank = {
  name: string;
  code: string;
  active: boolean;
};

// Financial & Commission Spec v1.0, section 3.2 dev note — creates/links a
// Paystack subaccount for a vendor at approval time so the 80/20 split
// happens automatically at charge time via Paystack's Split Payment feature.
export class PaystackSubaccountService {
  private banksCache: PaystackBank[] | null = null;

  private assertConfigured = () => {
    if (!paystackSecretKey) {
      throw new InternalServerError(
        "Paystack secret key is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }
  };

  // Paystack's bank list rarely changes — cached in-process for the life of
  // this instance rather than re-fetched on every subaccount creation.
  listNigerianBanks = async (): Promise<PaystackBank[]> => {
    if (this.banksCache) {
      return this.banksCache;
    }

    this.assertConfigured();

    const response = await fetch(`${paystackBaseUrl}/bank?currency=NGN`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: PaystackBank[];
    };

    if (!response.ok || !data.status || !data.data) {
      throw new BadRequestException(
        data.message || "Unable to fetch bank list from Paystack",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    this.banksCache = data.data;
    return data.data;
  };

  resolveBankCode = async (bankName: string): Promise<string> => {
    const banks = await this.listNigerianBanks();
    const normalized = bankName.trim().toLowerCase();

    const match =
      banks.find((bank) => bank.name.toLowerCase() === normalized) ??
      banks.find((bank) => bank.name.toLowerCase().includes(normalized));

    if (!match) {
      throw new BadRequestException(
        `Could not match "${bankName}" to a recognized Nigerian bank — please use the exact bank name (e.g. "Guaranty Trust Bank").`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return match.code;
  };

  // percentage_charge is the MAIN account's cut when Paystack applies this
  // subaccount's own default split (i.e. if no per-transaction override is
  // sent) — set to TOW's fixed 20% commission. Per-transaction calls
  // override this via `transaction_charge` (see checkout.service.ts), so
  // this default only matters as a fallback.
  createSubaccount = async (input: {
    businessName: string;
    bankName: string;
    accountNumber: string;
  }): Promise<{ subaccountCode: string }> => {
    this.assertConfigured();

    const bankCode = await this.resolveBankCode(input.bankName);

    const response = await fetch(`${paystackBaseUrl}/subaccount`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_name: input.businessName,
        settlement_bank: bankCode,
        account_number: input.accountNumber,
        percentage_charge: 20,
      }),
    });

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { subaccount_code: string };
    };

    if (!response.ok || !data.status || !data.data) {
      throw new BadRequestException(
        data.message || "Unable to create Paystack subaccount",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return { subaccountCode: data.data.subaccount_code };
  };
}
