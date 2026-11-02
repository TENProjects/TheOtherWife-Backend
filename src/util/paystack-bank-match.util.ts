/** @format */

/**
 * Matches a bank name typed by a vendor ("GTBank Plc", "Paycom(Opay)",
 * "monipoint") to exactly one bank in Paystack's official list. Precision
 * over convenience: money is sent to the result, so anything uncertain is
 * rejected rather than guessed.
 *
 *  1. exact match on the normalised name ("Plc", "Ltd", punctuation ignored)
 *  2. a reviewed table of common variants, pointing at Paystack's stable
 *     bank slug (not a name, which Paystack may reword)
 *  3. a partial name only if it matches ONE bank (whole words); two or more
 *     candidates ("Access" → Access Bank / Access Bank (Diamond)) is an error
 *
 * Paystack still verifies the account number against the chosen bank before
 * a subaccount exists, so a wrong match cannot route money to a stranger.
 */

export type PaystackBank = { name: string; code: string; slug?: string; active?: boolean };

export type BankMatch =
  | { ok: true; bank: PaystackBank }
  | { ok: false; reason: "unknown" | "ambiguous"; candidates?: string[] };

const STOP_WORDS = new Set(["plc", "ltd", "limited", "nigeria", "ng"]);

export const normaliseBankName = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(" ");

/** Normalised variant → Paystack bank slug. Keys must already be normalised. */
const VARIANTS: Record<string, string> = {
  gtbank: "guaranty-trust-bank",
  "gt bank": "guaranty-trust-bank",
  gtb: "guaranty-trust-bank",
  gtco: "guaranty-trust-bank",
  "guaranty trust": "guaranty-trust-bank",
  "guarantee trust bank": "guaranty-trust-bank",
  moniepoint: "moniepoint-mfb-ng",
  "monie point": "moniepoint-mfb-ng",
  monipoint: "moniepoint-mfb-ng",
  "moniepoint microfinance bank": "moniepoint-mfb-ng",
  "moniepoint microfinance": "moniepoint-mfb-ng",
  "moniepoint mfb": "moniepoint-mfb-ng",
  opay: "paycom",
  paycom: "paycom",
  "paycom opay": "paycom",
  "opay paycom": "paycom",
  "opay digital services": "paycom",
  palmpay: "palmpay",
  "palm pay": "palmpay",
  smartcash: "airtel-smartcash-psb-ng",
  "smartcash psb": "airtel-smartcash-psb-ng",
  "airtel smartcash": "airtel-smartcash-psb-ng",
  "smart cash psb": "airtel-smartcash-psb-ng",
  uba: "united-bank-for-africa",
  "united bank of africa": "united-bank-for-africa",
  "first bank": "first-bank-of-nigeria",
  firstbank: "first-bank-of-nigeria",
  fbn: "first-bank-of-nigeria",
  access: "access-bank",
  "access bank": "access-bank",
  zenith: "zenith-bank",
  kuda: "kuda-bank",
  "kuda mfb": "kuda-bank",
  "kuda microfinance bank": "kuda-bank",
  wema: "wema-bank",
  alat: "alat-by-wema",
  stanbic: "stanbic-ibtc-bank",
  "stanbic ibtc": "stanbic-ibtc-bank",
  fcmb: "first-city-monument-bank",
  "union bank": "union-bank-of-nigeria",
  ecobank: "ecobank-nigeria",
};

export function matchPaystackBank(input: string, banks: PaystackBank[]): BankMatch {
  const wanted = normaliseBankName(input ?? "");
  if (!wanted) return { ok: false, reason: "unknown" };
  const usable = banks.filter((bank) => bank.active !== false);

  const exact = usable.filter((bank) => normaliseBankName(bank.name) === wanted);
  if (exact.length === 1) return { ok: true, bank: exact[0] };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact.map((b) => b.name) };

  const slug = VARIANTS[wanted];
  if (slug) {
    const bySlug = usable.find((bank) => bank.slug === slug);
    if (bySlug) return { ok: true, bank: bySlug };
  }

  if (wanted.length >= 4) {
    const pattern = new RegExp(`(^| )${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
    const partial = usable.filter((bank) => pattern.test(normaliseBankName(bank.name)));
    if (partial.length === 1) return { ok: true, bank: partial[0] };
    if (partial.length > 1) return { ok: false, reason: "ambiguous", candidates: partial.map((b) => b.name) };
  }
  return { ok: false, reason: "unknown" };
}
