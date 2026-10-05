/** @format */

import crypto from "crypto";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";

// Reversible encryption for secrets the server must be able to read back
// (partner webhook signing secrets, partner request-signing secrets) — unlike
// partner API keys, which are only ever stored as a one-way hash.
//
// AES-256-GCM, key from PARTNER_SECRETS_KEY (32 random bytes, base64). Read
// at call time so the app starts normally without it; only configuring a
// webhook or a signed credential requires it.
//
// Format: "v1:" + base64(iv[12] | authTag[16] | ciphertext)

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const notConfigured = () =>
  new AppError(
    "PARTNER_SECRETS_KEY is not configured on this server",
    HttpStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL_SERVER_ERROR,
  );

const getKey = (): Buffer => {
  const raw = process.env.PARTNER_SECRETS_KEY;
  if (!raw) throw notConfigured();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new AppError(
      "PARTNER_SECRETS_KEY must be 32 bytes, base64-encoded",
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }
  return key;
};

export const isSecretBoxConfigured = (): boolean => {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
};

export const sealSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
};

export const openSecret = (sealed: string): string => {
  const [version, payload] = sealed.split(":");
  if (version !== VERSION || !payload) {
    throw new Error("Unsupported sealed secret format");
  }
  const buf = Buffer.from(payload, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Sealed secret is truncated");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

// 32 random bytes as base64url — used for webhook and request-signing secrets.
export const generateSigningSecret = (prefix: "whsec" | "tow_sk"): string =>
  `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
