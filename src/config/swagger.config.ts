/** @format */

import swaggerJSDoc from "swagger-jsdoc";
import { hostName } from "../constants/env.js";

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "The Other Wife API",
    version: "1.0.0",
    description: "The Other Wife backend API documentation",
  },
  servers: [
    {
      url: hostName,
      description: "Configured Host",
    },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "token",
      },
    },
    schemas: {
      User: {
        type: "object",
        required: ["firstName", "lastName", "email", "phoneNumber"],
        properties: {
          _id: {
            type: "string",
            description: "The user unique identifier",
          },
          firstName: {
            type: "string",
            description: "The user first name",
          },
          lastName: {
            type: "string",
            description: "The user last name",
          },
          email: {
            type: "string",
            description: "The user email address",
          },
          phoneNumber: {
            type: "string",
            description: "The user phone number",
          },
          userType: {
            type: "string",
            description: "The user type",
            $ref: "#/components/schemas/UserType",
          },
        },
      },
      Meal: {
        type: "object",
        properties: {
          vendorId: {
            type: "string",
            description: "The vendor unique identifier",
          },
          name: {
            type: "string",
            description: "The meal name",
          },
          description: {
            type: "string",
            description: "The meal description",
          },
          price: {
            type: "number",
            description: "The meal price",
          },
          categoryName: {
            type: "string",
            description: "The category name of the meal",
          },
          availableFrom: {
            type: "string",
            description: "The date the meal is available from",
          },
          availableUntil: {
            type: "string",
            description: "The date the meal is available until",
          },
          primaryImageUrl: {
            type: "string",
            description: "The primary image url of the meal",
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "The tags of the meal",
          },
          ratingAverage: {
            type: "number",
            description: "The average rating for the meal",
          },
          ratingCount: {
            type: "number",
            description: "The number of ratings for the meal",
          },
          ratingScore: {
            type: "number",
            description: "Weighted score derived from the meal ratings",
          },
        },
      },
      Customer: {
        type: "object",
        properties: {
          _id: {
            type: "string",
            description: "The customer unique identifier",
          },
          userId: {
            type: "string",
            description: "The customer user identifier",
          },
          addressId: {
            type: "string",
            description: "The customer address identifier",
          },
          profileImageUrl: {
            type: "string",
            description: "The customer profile image url",
          },
        },
      },
      Vendor: {
        type: "object",
        properties: {
          _id: {
            type: "string",
            description: "The vendor unique identifier",
          },
          userId: {
            type: "string",
            description: "The vendor user identifier",
          },
          addressId: {
            type: "string",
            description: "The vendor address identifier",
          },
          businessName: {
            type: "string",
            description: "The vendor business name",
          },
          businessDescription: {
            type: "string",
            description: "The vendor business description",
          },
          businessLogoUrl: {
            type: "string",
            description: "The vendor business logo url",
          },
          approvalStatus: {
            $ref: "#/components/schemas/VendorApprovalStatus",
          },
          approvedBy: {
            type: "string",
            description: "The vendor approved by",
          },
          approvedAt: {
            type: "string",
            format: "date-time",
            description: "The vendor approved at",
          },
          rejectionReason: {
            type: "string",
            description: "The vendor rejection reason",
          },
          ratingAverage: {
            type: "number",
            description: "The vendor average rating",
          },
          ratingCount: {
            type: "number",
            description: "The number of ratings received by the vendor",
          },
          ratingScore: {
            type: "number",
            description:
              "Weighted rating score used for featured vendor ranking",
          },
        },
      },
      MealReviewRequest: {
        type: "object",
        required: ["orderId", "rating"],
        properties: {
          orderId: {
            type: "string",
            description: "The order being reviewed",
          },
          rating: {
            type: "number",
            minimum: 1,
            maximum: 5,
            description: "The rating score from 1 to 5",
          },
          comment: {
            type: "string",
            description: "Optional review comment",
          },
        },
      },
      VendorOnboardingStep1Request: {
        type: "object",
        required: [
          "firstName",
          "lastName",
          "email",
          "phoneNumber",
          "password",
          "confirmPassword",
          "state",
          "city",
        ],
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
          phoneNumber: { type: "string" },
          password: { type: "string", format: "password" },
          confirmPassword: { type: "string", format: "password" },
          state: { type: "string" },
          city: { type: "string" },
          address: { type: "string" },
          socials: {
            type: "object",
            properties: {
              instagram: { type: "string" },
              facebook: { type: "string" },
              twitter: { type: "string" },
            },
          },
        },
      },
      VendorOnboardingStep2Request: {
        type: "object",
        required: [
          "businessName",
          "yearsOfExperience",
          "cuisines",
          "bankName",
          "accountNumber",
        ],
        properties: {
          businessName: { type: "string" },
          businessDescription: { type: "string" },
          businessLogoUrl: { type: "string" },
          yearsOfExperience: { type: "number" },
          cuisines: {
            type: "array",
            items: { type: "string" },
          },
          bankName: { type: "string" },
          accountNumber: { type: "string" },
          accountName: { type: "string" },
        },
      },
      VendorOnboardingUploadSignatureRequest: {
        type: "object",
        required: ["documentType"],
        properties: {
          documentType: {
            type: "string",
            enum: ["governmentId", "businessCertificate", "displayImage"],
          },
        },
      },
      VendorOnboardingDocumentRequest: {
        type: "object",
        required: ["fileUrl", "publicId"],
        properties: {
          fileUrl: { type: "string" },
          fileName: { type: "string" },
          mimeType: { type: "string" },
          publicId: { type: "string" },
          resourceType: { type: "string" },
        },
      },
      VendorOnboardingStep3Request: {
        type: "object",
        required: [
          "governmentId",
          "businessCertificate",
          "displayImage",
          "confirmedAccuracy",
          "acceptedTerms",
          "acceptedVerification",
        ],
        properties: {
          governmentId: {
            $ref: "#/components/schemas/VendorOnboardingDocumentRequest",
          },
          businessCertificate: {
            $ref: "#/components/schemas/VendorOnboardingDocumentRequest",
          },
          displayImage: {
            $ref: "#/components/schemas/VendorOnboardingDocumentRequest",
          },
          confirmedAccuracy: { type: "boolean" },
          acceptedTerms: { type: "boolean" },
          acceptedVerification: { type: "boolean" },
        },
      },
      Address: {
        type: "object",
        properties: {
          _id: { type: "string" },
          userId: { type: "string" },
          label: { $ref: "#/components/schemas/AddressLabel" },
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          country: { type: "string" },
          postalCode: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          isDefault: { type: "boolean" },
        },
      },
      Cart: {
        type: "object",
        properties: {
          _id: { type: "string" },
          customerId: { type: "string" },
          meals: {
            type: "array",
            items: { $ref: "#/components/schemas/CartItem" },
          },
          totalAmount: { type: "number" },
        },
      },
      CartItem: {
        type: "object",
        properties: {
          mealId: { type: "string" },
          price: { type: "number" },
          quantity: { type: "number" },
          totalPrice: { type: "number" },
        },
      },
      UserType: {
        type: "string",
        enum: ["customer", "vendor", "admin"],
      },
      AddressLabel: {
        type: "string",
        enum: ["home", "work", "other"],
      },
      CheckoutPaymentProvider: {
        type: "string",
        enum: ["paystack", "cash", "wallet"],
      },
      CheckoutConfirmRequest: {
        type: "object",
        required: ["addressId", "cartUpdatedAt"],
        properties: {
          addressId: {
            type: "string",
            example: "67ff2f8be1234567890abcde",
          },
          cartUpdatedAt: {
            type: "string",
            format: "date-time",
            description:
              "Concurrency token from /checkout/preview to ensure the cart has not changed.",
            example: "2026-03-17T12:00:00.000Z",
          },
          paymentProvider: {
            $ref: "#/components/schemas/CheckoutPaymentProvider",
            default: "paystack",
          },
        },
      },
      CheckoutConfirmResponse: {
        type: "object",
        properties: {
          order: {
            type: "object",
            description: "Created order record",
          },
          payment: {
            type: "object",
            description:
              "Created payment record. For Paystack, authorizationUrl is returned here.",
            properties: {
              provider: {
                $ref: "#/components/schemas/CheckoutPaymentProvider",
              },
              status: {
                type: "string",
              },
              authorizationUrl: {
                type: "string",
                nullable: true,
                description:
                  "Paystack checkout URL. Null or omitted for cash payments.",
                example: "https://checkout.paystack.com/abc123",
              },
              accessCode: {
                type: "string",
                nullable: true,
              },
            },
          },
          preview: {
            type: "object",
            description: "Checkout snapshot used to create the order",
          },
        },
      },
      VendorApprovalStatus: {
        type: "string",
        enum: ["pending", "approved", "suspended", "rejected"],
      },
      ErrorResponse: {
        type: "object",
        properties: {
          message: { type: "string" },
          error: { type: "string" },
          status: { type: "string", example: "error" },
        },
      },
      ApiResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          message: { type: "string" },
          data: { type: "object" },
        },
      },
    },
    responses: {
      "400": {
        description: "Bad request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "401": {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "403": {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "404": {
        description: "Not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  },
  security: [
    {
      cookieAuth: [],
    },
  ],
};

const options = {
  definition: swaggerDefinition,
  apis: [
    "./src/routes/*.{ts,js}",
    "./src/controllers/*.{ts,js}",
    "./app.{ts,js}",
    "./dist/src/routes/*.{ts,js}",
    "./dist/src/controllers/*.{ts,js}",
    "./dist/app.{ts,js}",
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
console.log("CWD:", process.cwd());
console.log("Swagger Paths:", Object.keys((swaggerSpec as any).paths || {}));
