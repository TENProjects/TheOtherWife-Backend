/** @format */

import { envconfig } from "../config/env.config.js";

export const port: string = envconfig.PORT;
export const hostName: string = envconfig.HOST_NAME;
export const mongoUri: string = envconfig.MONGODB_URI;
export const nodeEnv: string = envconfig.NODE_ENV;
export const jwtSecret: string = envconfig.JWT_SECRET;
export const jwtRefreshSecret: string = envconfig.JWT_REFRESH_SECRET;
export const googleClientId: string = envconfig.GOOGLE_CLIENT_ID;
export const corsOrigin: string | string[] | undefined = envconfig.CORS_ORIGIN
  ? envconfig.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : undefined;
export const resendApiKey: string = envconfig.RESEND_API_KEY;
export const from: string = envconfig.FROM;
export const paystackSecretKey: string = envconfig.PAYSTACK_SECRET_KEY;
export const paystackPublicKey: string = envconfig.PAYSTACK_PUBLIC_KEY;
export const paystackBaseUrl: string = envconfig.PAYSTACK_BASE_URL;
export const paystackCallbackUrl: string = envconfig.PAYSTACK_CALLBACK_URL;
export const cloudinaryCloudName: string = envconfig.CLOUDINARY_CLOUD_NAME;
export const cloudinaryApiKey: string = envconfig.CLOUDINARY_API_KEY;
export const cloudinaryApiSecret: string = envconfig.CLOUDINARY_API_SECRET;
export const expoAccessToken: string | undefined = envconfig.EXPO_ACCESS_TOKEN;
export const frontendUrl: string = envconfig.FRONTEND_URL;
export const resetPasswordTokenTtlMinutes: number =
  envconfig.RESET_PASSWORD_TOKEN_TTL_MINUTES;
export const searchRadiusKm: number = envconfig.SEARCH_RADIUS_KM;

console.log("port", !!port);
console.log("hostName", !!hostName);
console.log("mongoUri", !!mongoUri);
console.log("nodeEnv", !!nodeEnv);
console.log("jwtSecret", !!jwtSecret);
console.log("jwtRefreshSecret", !!jwtRefreshSecret);
console.log("googleClientId", !!googleClientId);
console.log("resendApiKey", !!resendApiKey);
console.log("from", !!from);
console.log("paystackSecretKey", !!paystackSecretKey);
console.log("paystackPublicKey", !!paystackPublicKey);
console.log("paystackBaseUrl", !!paystackBaseUrl);
console.log("paystackCallbackUrl", !!paystackCallbackUrl);
console.log("cloudinaryCloudName", !!cloudinaryCloudName);
console.log("cloudinaryApiKey", !!cloudinaryApiKey);
console.log("cloudinaryApiSecret", !!cloudinaryApiSecret);
console.log("expoAccessToken", !!expoAccessToken);
console.log("frontendUrl", !!frontendUrl);
console.log("resetPasswordTokenTtlMinutes", !!resetPasswordTokenTtlMinutes);
