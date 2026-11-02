/** @format */

/**
 * Vendor bank details come from two places:
 *  - payoutSettings.bankDetails: saved by the vendor in the app's payout
 *    settings. This is the source of truth for payouts and Paystack.
 *  - additionalData.payout: captured at onboarding step 2
 *    (vendor-onboarding.service.ts) and, until now, never used for payouts.
 *
 * adoptOnboardingBankDetails() fills an EMPTY payoutSettings.bankDetails from
 * the onboarding details so an approved vendor can be paid and get a Paystack
 * subaccount without re-entering them. Rules, in order of safety:
 *  - never overwrite or merge with anything already in payoutSettings
 *    (if either bankName or accountNumber is set there, nothing is copied)
 *  - only copy complete, well-formed details (bank name + 10-digit NUBAN)
 *  - Paystack still verifies the account with the bank when the subaccount
 *    is created; a bad number fails there and is surfaced to admins
 */

export type BankDetails = { bankName: string; accountNumber: string; accountName?: string };

const NUBAN = /^\d{10}$/;
const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Complete, well-formed onboarding bank details, or null. */
export function onboardingBankDetails(additionalData: unknown): BankDetails | null {
  const payout = (additionalData as { payout?: Record<string, unknown> } | null | undefined)?.payout;
  if (!payout || typeof payout !== "object") return null;
  const bankName = clean(payout.bankName);
  const accountNumber = clean(payout.accountNumber);
  const accountName = clean(payout.accountName);
  if (!bankName || bankName.length > 120 || !NUBAN.test(accountNumber)) return null;
  return { bankName, accountNumber, ...(accountName ? { accountName: accountName.slice(0, 200) } : {}) };
}

/** True when the vendor has saved any bank detail in payout settings. */
export function hasPayoutBankDetails(payoutSettings: unknown): boolean {
  const bank = (payoutSettings as { bankDetails?: Record<string, unknown> } | null | undefined)?.bankDetails;
  return Boolean(clean(bank?.bankName) || clean(bank?.accountNumber));
}

/**
 * Copies onboarding bank details into an empty payoutSettings.bankDetails on
 * the given (unsaved) vendor document. Returns true if it copied anything; the
 * caller saves the document.
 */
export function adoptOnboardingBankDetails(vendor: {
  payoutSettings?: { bankDetails?: Partial<BankDetails> } | null;
  additionalData?: unknown;
  markModified?: (path: string) => void;
}): boolean {
  if (hasPayoutBankDetails(vendor.payoutSettings)) return false;
  const fromOnboarding = onboardingBankDetails(vendor.additionalData);
  if (!fromOnboarding) return false;
  if (!vendor.payoutSettings) {
    (vendor as { payoutSettings: unknown }).payoutSettings = { bankDetails: fromOnboarding };
  } else {
    vendor.payoutSettings.bankDetails = fromOnboarding;
  }
  vendor.markModified?.("payoutSettings");
  return true;
}
