/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { InternalServerError } from "../errors/internal-server.error.js";
import { paystackSecretKey, paystackBaseUrl } from "../constants/env.js";
import { matchPaystackBank, type PaystackBank } from "../util/paystack-bank-match.util.js";

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

  /** The one Paystack bank a vendor's bank name refers to (see paystack-bank-match.util.ts). */
  resolveBank = async (bankName: string): Promise<PaystackBank> => {
    const match = matchPaystackBank(bankName, await this.listNigerianBanks());
    if (!match.ok) {
      throw new BadRequestException(
        match.reason === "ambiguous"
          ? `"${bankName}" could mean more than one bank (${(match.candidates ?? []).slice(0, 3).join(", ")}). Please use the full bank name.`
          : `Could not match "${bankName}" to a recognized Nigerian bank — please use the exact bank name (e.g. "Guaranty Trust Bank").`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    return match.bank;
  };

  resolveBankCode = async (bankName: string): Promise<string> => (await this.resolveBank(bankName)).code;

  /**
   * Read-only bank lookup: the name the bank holds for this account. Creates
   * nothing. Used to let a person confirm an account belongs to the vendor
   * before a subaccount is created (scripts/backfill-paystack-subaccounts.ts).
   */
  resolveAccount = async (
    bankName: string,
    accountNumber: string,
  ): Promise<{ bankName: string; bankCode: string; accountName: string }> => {
    this.assertConfigured();
    const bank = await this.resolveBank(bankName);
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BadRequestException("Account number must be 10 digits", HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
    }
    const response = await fetch(
      `${paystackBaseUrl}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`,
      { headers: { Authorization: `Bearer ${paystackSecretKey}` } },
    );
    const data = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: { account_name?: string; account_number?: string };
    };
    if (!response.ok || !data.status || !data.data?.account_name || data.data.account_number !== accountNumber) {
      throw new BadRequestException(
        data.message || "Could not verify this account with the bank",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    return { bankName: bank.name, bankCode: bank.code, accountName: data.data.account_name };
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
