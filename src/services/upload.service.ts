/** @format */

import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { CloudinaryService } from "./cloudinary.service.js";

type UploadAssetType =
  | "vendorDocument"
  | "vendorBusinessLogo"
  | "mealImage"
  | "customerProfileImage";

export class UploadService {
  private cloudinaryService: CloudinaryService;

  constructor() {
    this.cloudinaryService = new CloudinaryService();
  }

  createCloudinaryUploadSignature = (
    userId: string,
    userType: string,
    assetType: UploadAssetType,
  ) => {
    if (!userId || !userType) {
      throw new BadRequestException(
        "User context is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const roleToAssetMap: Record<string, UploadAssetType[]> = {
      customer: ["customerProfileImage"],
      vendor: ["vendorDocument", "vendorBusinessLogo", "mealImage"],
      admin: [],
    };

    if (!roleToAssetMap[userType]?.includes(assetType)) {
      throw new BadRequestException(
        "Asset type is not allowed for this user",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return this.cloudinaryService.createUploadSignature(userId, assetType);
  };
}
