/** @format */

import crypto from "crypto";
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

export class CloudinaryService {
  private ensureConfigured = () => {
    if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
      throw new BadRequestException(
        "Cloudinary is not configured",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  createVendorOnboardingUploadSignature = (
    userId: string,
    documentType: CloudinaryDocumentType,
  ) => {
    this.ensureConfigured();

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `the-other-wife/vendors/${userId}/${documentType}`;
    const publicId = `${documentType}-${timestamp}`;
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
}
