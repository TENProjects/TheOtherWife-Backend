/** @format */

import swaggerJSDoc from "swagger-jsdoc";
import { hostName } from "../constants/constants.js";

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "The Other Wife API",
    version: "1.0.0",
    description: "The Other Wife backend API documentation",
  },
  servers: [
    {
      url: "https://the-other-wife.vercel.app/",
      description: "Vercel Production",
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
          _id: {
            type: "string",
            description: "The meal unique identifier",
          },
          vendorId: {
            type: "string",
            description: "The vendor unique identifier",
          },
          categoryId: {
            type: "string",
            description: "The category unique identifier",
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
          imageUrl: {
            type: "string",
            description: "The meal image url",
          },
          isAvailable: {
            type: "boolean",
            description: "Whether the meal is available",
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
          additionalImages: {
            type: "array",
            items: {
              type: "string",
            },
            description: "The additional images of the meal",
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "The tags of the meal",
          },
          preparationTime: {
            type: "number",
            description: "The preparation time of the meal",
          },
          servingSize: {
            type: "string",
            description: "The serving size of the meal",
          },
          additionalData: {
            type: "string",
            description: "The additional data of the meal",
          },
          isDeleted: {
            type: "boolean",
            description: "Whether the meal is deleted",
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
