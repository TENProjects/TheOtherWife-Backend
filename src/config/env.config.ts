/** @format */

import { config } from "dotenv";

const envFilePath =
  process.env.ENV_FILE ||
  process.env.DOTENV_CONFIG_PATH ||
  (process.env.NODE_ENV === "production" ? "./.env.prod" : "./.env");

config({ path: envFilePath });

type EnvConfig = {
  PORT: string;
  HOST_NAME: string;
  MONGODB_URI: string;
  NODE_ENV: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_ANDROID_CLIENT_ID?: string;
  GOOGLE_IOS_CLIENT_ID?: string;
  CORS_ORIGIN?: string;
  RESEND_API_KEY: string;
  FROM: string;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_PUBLIC_KEY: string;
  PAYSTACK_BASE_URL: string;
  PAYSTACK_CALLBACK_URL: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  EXPO_ACCESS_TOKEN?: string;
  FRONTEND_URL: string;
  RESET_PASSWORD_TOKEN_TTL_MINUTES: number;
  SEARCH_RADIUS_KM: number;
};

const getEnvConfig = (): EnvConfig => {
  const getEnv = (key: string): string => process.env[key] ?? "";

  return {
    PORT: getEnv("PORT") || "8000",
    HOST_NAME: getEnv("HOST_NAME") || "https://the-other-wife-backend.vercel.app",
    MONGODB_URI: getEnv("MONGODB_URI") || "mongodb://localhost:27017",
    NODE_ENV: getEnv("NODE_ENV") || "development",
    JWT_SECRET: getEnv("JWT_SECRET") || "secret",
    JWT_REFRESH_SECRET: getEnv("JWT_REFRESH_SECRET") || "refresh_secret",
    GOOGLE_CLIENT_ID: getEnv("GOOGLE_CLIENT_ID"),
    GOOGLE_ANDROID_CLIENT_ID: getEnv("GOOGLE_ANDROID_CLIENT_ID"),
    GOOGLE_IOS_CLIENT_ID: getEnv("GOOGLE_IOS_CLIENT_ID"),
    CORS_ORIGIN: getEnv("CORS_ORIGIN") || "",
    RESEND_API_KEY: getEnv("RESEND_API_KEY"),
    FROM: getEnv("FROM"),
    PAYSTACK_SECRET_KEY: getEnv("PAYSTACK_SECRET_KEY"),
    PAYSTACK_PUBLIC_KEY: getEnv("PAYSTACK_PUBLIC_KEY"),
    PAYSTACK_BASE_URL: getEnv("PAYSTACK_BASE_URL") || "https://api.paystack.co",
    PAYSTACK_CALLBACK_URL: getEnv("PAYSTACK_CALLBACK_URL"),
    CLOUDINARY_CLOUD_NAME: getEnv("CLOUDINARY_CLOUD_NAME"),
    CLOUDINARY_API_KEY: getEnv("CLOUDINARY_API_KEY"),
    CLOUDINARY_API_SECRET: getEnv("CLOUDINARY_API_SECRET"),
    EXPO_ACCESS_TOKEN: getEnv("EXPO_ACCESS_TOKEN"),
    FRONTEND_URL: getEnv("FRONTEND_URL") || "http://localhost:3000",
    RESET_PASSWORD_TOKEN_TTL_MINUTES: Number(
      getEnv("RESET_PASSWORD_TOKEN_TTL_MINUTES") || "30",
    ),
    SEARCH_RADIUS_KM: Number(getEnv("SEARCH_RADIUS_KM") || "25"),
  };
};

const envconfig = getEnvConfig();

export { envconfig };
