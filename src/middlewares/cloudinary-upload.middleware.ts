/** @format */

import type { NextFunction, Request, Response } from "express";
import { CloudinaryService } from "../services/cloudinary.service.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

const cloudinaryService = new CloudinaryService();

const parseStringArrayInput = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseDocumentInput = (value: unknown) => {
  if (!value) {
    return value;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const requireUserId = (req: Request) => {
  const userId = req.user?._id?.toString();
  if (!userId) {
    throw new BadRequestException(
      "User context is required",
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  return userId;
};

export const uploadProfileImageToCloudinary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const file = req.file;
    if (!file) {
      next();
      return;
    }

    const userId = requireUserId(req);
    const result = await cloudinaryService.uploadImageBuffer(
      file.buffer,
      userId,
      "customerProfileImage",
      "profile-image",
    );

    req.body.profileImageUrl = result.secureUrl;
    next();
  } catch (error) {
    next(error);
  }
};

export const uploadBusinessLogoToCloudinary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const file = req.file;
    if (!file) {
      next();
      return;
    }

    const userId = requireUserId(req);
    const result = await cloudinaryService.uploadImageBuffer(
      file.buffer,
      userId,
      "vendorBusinessLogo",
      "business-logo",
    );

    req.body.businessLogoUrl = result.secureUrl;
    next();
  } catch (error) {
    next(error);
  }
};

export const uploadBlogFeaturedImageToCloudinary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const file = req.file;
    if (!file) {
      next();
      return;
    }

    const userId = requireUserId(req);
    const result = await cloudinaryService.uploadImageBuffer(
      file.buffer,
      userId,
      "adminBlogImage",
      "blog-featured-image",
    );

    req.body.featuredImageUrl = result.secureUrl;
    next();
  } catch (error) {
    next(error);
  }
};

export const uploadMealImagesToCloudinary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;

    if (!files) {
      next();
      return;
    }

    const userId = requireUserId(req);
    const primaryImage = files.primaryImage?.[0];
    const additionalImages = files.additionalImages ?? [];

    if (primaryImage) {
      const primaryResult = await cloudinaryService.uploadImageBuffer(
        primaryImage.buffer,
        userId,
        "mealImage",
        "primary-image",
      );
      req.body.primaryImageUrl = primaryResult.secureUrl;
    }

    if (additionalImages.length > 0) {
      const uploadedAdditionalImages = await Promise.all(
        additionalImages.map(async (file, index) => {
          const image = await cloudinaryService.uploadImageBuffer(
            file.buffer,
            userId,
            "mealImage",
            `additional-image-${index + 1}`,
          );
          return image.secureUrl;
        }),
      );

      const existingAdditionalImages = parseStringArrayInput(
        req.body.additionalImages,
      );
      req.body.additionalImages = [
        ...existingAdditionalImages,
        ...uploadedAdditionalImages,
      ];
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const uploadVendorOnboardingAssetsToCloudinary = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | undefined;

    if (typeof req.body.confirmedAccuracy === "string") {
      req.body.confirmedAccuracy =
        req.body.confirmedAccuracy.toLowerCase() === "true";
    }

    if (typeof req.body.acceptedTerms === "string") {
      req.body.acceptedTerms = req.body.acceptedTerms.toLowerCase() === "true";
    }

    if (typeof req.body.acceptedVerification === "string") {
      req.body.acceptedVerification =
        req.body.acceptedVerification.toLowerCase() === "true";
    }

    req.body.governmentId = parseDocumentInput(req.body.governmentId);
    req.body.businessCertificate = parseDocumentInput(req.body.businessCertificate);
    req.body.displayImage = parseDocumentInput(req.body.displayImage);

    if (typeof req.body.cuisines === "string") {
      req.body.cuisines = parseStringArrayInput(req.body.cuisines);
    }

    if (!files) {
      next();
      return;
    }

    const userId = requireUserId(req);

    const businessLogo = files.businessLogo?.[0];
    if (businessLogo) {
      const uploadedLogo = await cloudinaryService.uploadImageBuffer(
        businessLogo.buffer,
        userId,
        "vendorBusinessLogo",
        "onboarding-business-logo",
      );
      req.body.businessLogoUrl = uploadedLogo.secureUrl;
    }

    const uploadDocumentFromFile = async (
      file: Express.Multer.File | undefined,
      assetLabel: string,
    ) => {
      if (!file) {
        return undefined;
      }

      const uploaded = await cloudinaryService.uploadImageBuffer(
        file.buffer,
        userId,
        "vendorDocument",
        assetLabel,
      );

      return {
        fileUrl: uploaded.secureUrl,
        fileName: file.originalname,
        mimeType: file.mimetype,
        publicId: uploaded.publicId,
        resourceType: "image",
      };
    };

    const [governmentId, businessCertificate, displayImage] = await Promise.all([
      uploadDocumentFromFile(files.governmentIdFile?.[0], "government-id"),
      uploadDocumentFromFile(
        files.businessCertificateFile?.[0],
        "business-certificate",
      ),
      uploadDocumentFromFile(files.displayImageFile?.[0], "display-image"),
    ]);

    if (governmentId) {
      req.body.governmentId = governmentId;
    }

    if (businessCertificate) {
      req.body.businessCertificate = businessCertificate;
    }

    if (displayImage) {
      req.body.displayImage = displayImage;
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const ensureCreateMealImage = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (typeof req.body.primaryImageUrl === "string" && req.body.primaryImageUrl) {
    next();
    return;
  }

  next(
    new BadRequestException(
      "A primary meal image file or primaryImageUrl is required",
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    ),
  );
};
