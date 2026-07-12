/** @format */

import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import {
  cloudinaryApiKey,
  cloudinaryApiSecret,
  cloudinaryCloudName,
} from "../constants/env.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

type CloudinaryDocumentType =
  | "governmentId"
  | "businessCertificate"
  | "displayImage";
export type CloudinaryAssetType =
  | "vendorDocument"
  | "vendorBusinessLogo"
  | "mealImage"
  | "customerProfileImage"
  | "adminBlogImage";

export class CloudinaryService {
  private static isConfigured = false;

  private ensureConfigured = () => {
    if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
      throw new BadRequestException(
        "Cloudinary is not configured",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (!CloudinaryService.isConfigured) {
      cloudinary.config({
        cloud_name: cloudinaryCloudName,
        api_key: cloudinaryApiKey,
        api_secret: cloudinaryApiSecret,
        secure: true,
      });
      CloudinaryService.isConfigured = true;
    }
  };

  createVendorOnboardingUploadSignature = (
    userId: string,
    documentType: CloudinaryDocumentType,
  ) => {
    return this.createUploadSignature(userId, "vendorDocument", documentType);
  };

  createUploadSignature = (
    userId: string,
    assetType: CloudinaryAssetType,
    assetLabel?: string,
  ) => {
    this.ensureConfigured();

    const timestamp = Math.floor(Date.now() / 1000);
    const assetName = assetLabel ?? assetType;
    const folder = `the-other-wife/${assetType}/${userId}`;
    const publicId = `${assetName}-${timestamp}`;
    const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha1")
      .update(`${paramsToSign}${cloudinaryApiSecret}`)
      .digest("hex");

    return {
      cloudName: cloudinaryCloudName,
      apiKey: cloudinaryApiKey,
      timestamp,
      folder,
      publicId,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/auto/upload`,
    };
  };

  uploadImageBuffer = async (
    buffer: Buffer,
    userId: string,
    assetType: CloudinaryAssetType,
    assetLabel?: string,
  ): Promise<{ secureUrl: string; publicId: string }> => {
    this.ensureConfigured();

    if (!buffer?.length) {
      throw new BadRequestException(
        "Image file is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const assetName = assetLabel ?? assetType;
    const folder = `the-other-wife/${assetType}/${userId}`;
    const publicId = `${assetName}-${timestamp}-${crypto.randomInt(1000, 9999)}`;

    return await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "image",
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            reject(
              new BadRequestException(
                "Cloudinary upload failed",
                HttpStatus.BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
              ),
            );
            return;
          }

          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
          });
        },
      );

      uploadStream.end(buffer);
    });
  };
}
