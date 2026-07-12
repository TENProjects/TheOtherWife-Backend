/** @format */

import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";

const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      return cb(
        new BadRequestException(
          "Only image files are allowed",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        ),
      );
    }

    cb(null, true);
  },
});

const withMulterErrorHandling =
  (
    multerMiddleware: (
      req: Request,
      res: Response,
      callback: (error?: unknown) => void,
    ) => void,
  ) =>
  (req: Request, res: Response, next: NextFunction) => {
    multerMiddleware(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof BadRequestException) {
        next(error);
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(
            new BadRequestException(
              `File size exceeds ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)}MB limit`,
              HttpStatus.BAD_REQUEST,
              ErrorCode.VALIDATION_ERROR,
            ),
          );
          return;
        }
      }

      next(
        new BadRequestException(
          "Invalid file upload payload",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        ),
      );
    });
  };

export const uploadProfileImage = withMulterErrorHandling(
  upload.single("profileImage"),
);

export const uploadBusinessLogo = withMulterErrorHandling(
  upload.single("businessLogo"),
);

export const uploadBlogFeaturedImage = withMulterErrorHandling(
  upload.single("featuredImage"),
);

export const uploadMealImages = withMulterErrorHandling(
  upload.fields([
    { name: "primaryImage", maxCount: 1 },
    { name: "additionalImages", maxCount: 8 },
  ]),
);

export const uploadVendorOnboardingFiles = withMulterErrorHandling(
  upload.fields([
    { name: "businessLogo", maxCount: 1 },
    { name: "governmentIdFile", maxCount: 1 },
    { name: "businessCertificateFile", maxCount: 1 },
    { name: "displayImageFile", maxCount: 1 },
  ]),
);
