/** @format */

import { AuthService } from "./auth.service.js";
import Vendor from "../models/vendor.model.js";
import { transaction } from "../util/transaction.util.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { ClientSession } from "mongoose";
import { CloudinaryService } from "./cloudinary.service.js";

type VendorOnboardingData = {
  onboarding: {
    step1Completed: boolean;
    step2Completed: boolean;
    step3Completed: boolean;
    submittedAt: string | null;
  };
  location: {
    state: string;
    city: string;
    address?: string;
  };
  socials: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
  };
  business: {
    yearsOfExperience?: number;
    cuisines: string[];
  };
  payout: {
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    isVerified: boolean;
  };
  documents: {
    governmentId: null | Record<string, string>;
    businessCertificate: null | Record<string, string>;
    displayImage: null | Record<string, string>;
  };
  consents: {
    confirmedAccuracy: boolean;
    acceptedTerms: boolean;
    acceptedVerification: boolean;
  };
};

export class VendorOnboardingService {
  private authService: AuthService;
  private cloudinaryService: CloudinaryService;

  constructor() {
    this.authService = new AuthService();
    this.cloudinaryService = new CloudinaryService();
  }

  private getDefaultAdditionalData = (): VendorOnboardingData => ({
    onboarding: {
      step1Completed: false,
      step2Completed: false,
      step3Completed: false,
      submittedAt: null,
    },
    location: {
      state: "",
      city: "",
    },
    socials: {},
    business: {
      cuisines: [],
    },
    payout: {
      isVerified: false,
    },
    documents: {
      governmentId: null,
      businessCertificate: null,
      displayImage: null,
    },
    consents: {
      confirmedAccuracy: false,
      acceptedTerms: false,
      acceptedVerification: false,
    },
  });

  private normalizeAdditionalData = (
    additionalData?: unknown,
  ): VendorOnboardingData => ({
    ...this.getDefaultAdditionalData(),
    ...(typeof additionalData === "object" && additionalData
      ? (additionalData as Partial<VendorOnboardingData>)
      : {}),
    onboarding: {
      ...this.getDefaultAdditionalData().onboarding,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "onboarding" in additionalData
        ? ((additionalData as Record<string, any>).onboarding ?? {})
        : {}),
    },
    location: {
      ...this.getDefaultAdditionalData().location,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "location" in additionalData
        ? ((additionalData as Record<string, any>).location ?? {})
        : {}),
    },
    socials: {
      ...this.getDefaultAdditionalData().socials,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "socials" in additionalData
        ? ((additionalData as Record<string, any>).socials ?? {})
        : {}),
    },
    business: {
      ...this.getDefaultAdditionalData().business,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "business" in additionalData
        ? ((additionalData as Record<string, any>).business ?? {})
        : {}),
    },
    payout: {
      ...this.getDefaultAdditionalData().payout,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "payout" in additionalData
        ? ((additionalData as Record<string, any>).payout ?? {})
        : {}),
    },
    documents: {
      ...this.getDefaultAdditionalData().documents,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "documents" in additionalData
        ? ((additionalData as Record<string, any>).documents ?? {})
        : {}),
    },
    consents: {
      ...this.getDefaultAdditionalData().consents,
      ...(typeof additionalData === "object" &&
      additionalData &&
      "consents" in additionalData
        ? ((additionalData as Record<string, any>).consents ?? {})
        : {}),
    },
  });

  private getVendorByUserId = async (userId: string, session?: ClientSession) => {
    const vendorQuery = Vendor.findOne({ userId });

    if (session) {
      vendorQuery.session(session);
    }

    const vendor = await vendorQuery;

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return vendor;
  };

  private assertStepProgress = (
    additionalData: VendorOnboardingData,
    requiredStep: 1 | 2 | 3,
  ) => {
    if (requiredStep >= 2 && !additionalData.onboarding.step1Completed) {
      throw new BadRequestException(
        "Step 1 must be completed first",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (requiredStep >= 3 && !additionalData.onboarding.step2Completed) {
      throw new BadRequestException(
        "Step 2 must be completed first",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  private assertNotSubmitted = (additionalData: VendorOnboardingData) => {
    if (additionalData.onboarding.submittedAt) {
      throw new BadRequestException(
        "Vendor onboarding has already been submitted",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
  };

  createStep1 = async (body: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    password: string;
    state: string;
    city: string;
    address?: string;
    socials?: {
      instagram?: string;
      facebook?: string;
      twitter?: string;
    };
  }) => {
    const { accessToken, refreshToken, ...userWithoutPassword } =
      await this.authService.signup(["vendor"])({
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        password: body.password,
        userType: "vendor",
        phoneNumber: body.phoneNumber,
      });

    const vendor = await Vendor.findOne({ userId: userWithoutPassword._id });

    if (!vendor) {
      throw new NotFoundException(
        "Vendor not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const nextAdditionalData = this.normalizeAdditionalData(vendor.additionalData);
    nextAdditionalData.onboarding.step1Completed = true;
    nextAdditionalData.location = {
      state: body.state,
      city: body.city,
      ...(body.address ? { address: body.address } : {}),
    };
    nextAdditionalData.socials = {
      ...(body.socials ?? {}),
    };

    vendor.additionalData = nextAdditionalData;
    await vendor.save();

    return {
      accessToken,
      refreshToken,
      userWithoutPassword,
      onboarding: {
        vendorId: vendor._id.toString(),
        currentStep: 1,
        nextStep: 2,
      },
    };
  };

  saveStep2 = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: {
        businessName: string;
        businessDescription?: string;
        businessLogoUrl?: string;
        yearsOfExperience: number;
        cuisines: string[];
        bankName: string;
        accountNumber: string;
        accountName?: string;
      },
    ) => {
      const vendor = await this.getVendorByUserId(userId, session);
      const additionalData = this.normalizeAdditionalData(vendor.additionalData);

      this.assertNotSubmitted(additionalData);
      this.assertStepProgress(additionalData, 2);

      vendor.businessName = body.businessName;
      vendor.businessDescription = body.businessDescription ?? "";
      if (body.businessLogoUrl) {
        vendor.businessLogoUrl = body.businessLogoUrl;
      }

      vendor.additionalData = {
        ...additionalData,
        business: {
          yearsOfExperience: body.yearsOfExperience,
          cuisines: body.cuisines,
        },
        payout: {
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountName: body.accountName,
          isVerified: false,
        },
        onboarding: {
          ...additionalData.onboarding,
          step2Completed: true,
        },
      };

      await vendor.save({ session });

      return {
        currentStep: 2,
        nextStep: 3,
        vendor,
      };
    },
  );

  saveStep3 = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: {
        governmentId: Record<string, string>;
        businessCertificate: Record<string, string>;
        displayImage: Record<string, string>;
        confirmedAccuracy: true;
        acceptedTerms: true;
        acceptedVerification: true;
      },
    ) => {
      const vendor = await this.getVendorByUserId(userId, session);
      const additionalData = this.normalizeAdditionalData(vendor.additionalData);

      this.assertNotSubmitted(additionalData);
      this.assertStepProgress(additionalData, 3);

      if (body.displayImage.fileUrl) {
        vendor.businessLogoUrl = body.displayImage.fileUrl;
      }

      vendor.additionalData = {
        ...additionalData,
        documents: {
          governmentId: body.governmentId,
          businessCertificate: body.businessCertificate,
          displayImage: body.displayImage,
        },
        consents: {
          confirmedAccuracy: body.confirmedAccuracy,
          acceptedTerms: body.acceptedTerms,
          acceptedVerification: body.acceptedVerification,
        },
        onboarding: {
          ...additionalData.onboarding,
          step3Completed: true,
        },
      };

      await vendor.save({ session });

      return {
        currentStep: 3,
        nextStep: "submit",
        vendor,
      };
    },
  );

  submit = transaction.use(async (session: ClientSession, userId: string) => {
    const vendor = await this.getVendorByUserId(userId, session);
    const additionalData = this.normalizeAdditionalData(vendor.additionalData);

    if (additionalData.onboarding.submittedAt) {
      return {
        approvalStatus: vendor.approvalStatus,
        submittedAt: additionalData.onboarding.submittedAt,
      };
    }

    this.assertStepProgress(additionalData, 3);

    if (!additionalData.onboarding.step3Completed) {
      throw new BadRequestException(
        "Step 3 must be completed before submission",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (
      !additionalData.documents.governmentId ||
      !additionalData.documents.businessCertificate ||
      !additionalData.documents.displayImage
    ) {
      throw new BadRequestException(
        "All required documents must be provided before submission",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (
      !additionalData.consents.confirmedAccuracy ||
      !additionalData.consents.acceptedTerms ||
      !additionalData.consents.acceptedVerification
    ) {
      throw new BadRequestException(
        "All required confirmations must be accepted before submission",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    additionalData.onboarding.submittedAt = new Date().toISOString();
    vendor.additionalData = additionalData;
    vendor.approvalStatus = "pending";

    await vendor.save({ session });

    return {
      approvalStatus: vendor.approvalStatus,
      submittedAt: additionalData.onboarding.submittedAt,
    };
  });

  getCurrentVendorOnboarding = async (userId: string) => {
    const vendor = await this.getVendorByUserId(userId);
    const additionalData = this.normalizeAdditionalData(vendor.additionalData);
    const completed = additionalData.onboarding;

    const currentStep = completed.step3Completed
      ? 3
      : completed.step2Completed
        ? 2
        : completed.step1Completed
          ? 1
          : 0;

    return {
      step: currentStep,
      completed: {
        step1: completed.step1Completed,
        step2: completed.step2Completed,
        step3: completed.step3Completed,
      },
      submittedAt: completed.submittedAt,
      approvalStatus: vendor.approvalStatus,
      profile: {
        businessName: vendor.businessName,
        businessDescription: vendor.businessDescription,
        businessLogoUrl: vendor.businessLogoUrl,
        location: additionalData.location,
        socials: additionalData.socials,
      },
      business: additionalData.business,
      payout: additionalData.payout,
      documents: additionalData.documents,
      consents: additionalData.consents,
    };
  };

  createUploadSignature = async (
    userId: string,
    documentType: "governmentId" | "businessCertificate" | "displayImage",
  ) => {
    await this.getVendorByUserId(userId);

    return this.cloudinaryService.createVendorOnboardingUploadSignature(
      userId,
      documentType,
    );
  };
}
