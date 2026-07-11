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
      MealOption: {
        type: "object",
        required: ["name", "price"],
        properties: {
          _id: {
            type: "string",
            description:
              "Stable identifier for this option, assigned by the server. Useful for referencing a specific option when submitting a selection.",
          },
          name: {
            type: "string",
            description: "The option name, e.g. 'Big Pack' or 'Beef'",
          },
          price: {
            type: "number",
            minimum: 0,
            description: "The additional price charged for this option",
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
            description: "The meal base price",
          },
          categoryName: {
            type: "string",
            description: "The category name of the meal",
          },
          publicationStatus: {
            type: "string",
            enum: ["draft", "published"],
            description:
              "Publishing state for storefront visibility. Draft meals are hidden from public listings.",
          },
          isAvailable: {
            type: "boolean",
            description:
              "Whether the meal can currently be ordered. Published meals can still be listed when unavailable.",
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
          preparationType: {
            type: "string",
            enum: ["freshly_cooked", "cook_and_freeze", "both"],
            description: "How the meal is prepared. Required when creating a meal.",
          },
          availability: {
            type: "string",
            enum: ["daily", "weekly", "custom"],
            default: "daily",
            description: "How often this meal is available for ordering.",
          },
          availabilitySchedule: {
            type: "array",
            items: { type: "string" },
            description:
              "Day names the meal is available on. Only used when availability is 'weekly'.",
            example: ["monday", "wednesday", "friday"],
          },
          availabilityNote: {
            type: "string",
            description:
              "Free-form note describing availability. Only used when availability is 'custom'.",
          },
          packagingOptions: {
            type: "array",
            items: { $ref: "#/components/schemas/MealOption" },
            description: "Vendor-defined packaging choices. Required on the customer meal-details/add-to-cart flow when non-empty.",
          },
          proteinOptions: {
            type: "array",
            items: { $ref: "#/components/schemas/MealOption" },
            description: "Vendor-defined protein choices. Required on the customer meal-details/add-to-cart flow when non-empty.",
          },
          drinksOptions: {
            type: "array",
            items: { $ref: "#/components/schemas/MealOption" },
            description: "Vendor-defined drink choices (optional for the customer).",
          },
          addOns: {
            type: "array",
            items: { $ref: "#/components/schemas/MealOption" },
            description: "Vendor-defined add-on choices (optional for the customer).",
          },
          spiceLevels: {
            type: "array",
            items: { type: "string", enum: ["mild", "medium", "hot", "extra"] },
            description:
              "Fixed, non-persisted set of spice-level choices offered on the meal-details screen (not vendor-priced).",
            example: ["mild", "medium", "hot", "extra"],
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
      Favourites: {
        type: "object",
        properties: {
          _id: { type: "string" },
          customerId: { type: "string" },
          favouriteMeals: {
            type: "array",
            items: { type: "string" },
            description: "Meal IDs the customer has favourited",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
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
          expoTokens: {
            type: "array",
            items: { type: "string" },
            description: "Expo push notification tokens for the customer device(s)",
          },
          pushNotificationsEnabled: {
            type: "boolean",
            description: "Whether push notifications are enabled for this customer",
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
          expoTokens: {
            type: "array",
            items: { type: "string" },
            description: "Expo push notification tokens for the vendor device(s)",
          },
          pushNotificationsEnabled: {
            type: "boolean",
            description: "Whether push notifications are enabled for this vendor",
          },
          approvalStatus: {
            $ref: "#/components/schemas/VendorApprovalStatus",
          },
          isAvailable: {
            type: "boolean",
            description: "Whether the vendor is currently available",
          },
          isReceivingOrders: {
            type: "boolean",
            description:
              "Calculated field: true when approved, available, and currently within opening hours",
          },
          openingHours: {
            type: "object",
            description:
              "Weekly opening hours with monday to sunday keys; each day includes isOpen, openTime, closeTime",
            properties: {
              monday: { $ref: "#/components/schemas/DailyOpeningHours" },
              tuesday: { $ref: "#/components/schemas/DailyOpeningHours" },
              wednesday: { $ref: "#/components/schemas/DailyOpeningHours" },
              thursday: { $ref: "#/components/schemas/DailyOpeningHours" },
              friday: { $ref: "#/components/schemas/DailyOpeningHours" },
              saturday: { $ref: "#/components/schemas/DailyOpeningHours" },
              sunday: { $ref: "#/components/schemas/DailyOpeningHours" },
            },
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
          numberOfOrders: {
            type: "number",
            description:
              "Number of paid/confirmed orders used as a featured vendor ranking tiebreaker",
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
      DailyOpeningHours: {
        type: "object",
        properties: {
          isOpen: {
            type: "boolean",
          },
          openTime: {
            type: "string",
            example: "09:00",
          },
          closeTime: {
            type: "string",
            example: "18:00",
          },
        },
      },
      VendorOpeningHours: {
        type: "object",
        properties: {
          monday: { $ref: "#/components/schemas/DailyOpeningHours" },
          tuesday: { $ref: "#/components/schemas/DailyOpeningHours" },
          wednesday: { $ref: "#/components/schemas/DailyOpeningHours" },
          thursday: { $ref: "#/components/schemas/DailyOpeningHours" },
          friday: { $ref: "#/components/schemas/DailyOpeningHours" },
          saturday: { $ref: "#/components/schemas/DailyOpeningHours" },
          sunday: { $ref: "#/components/schemas/DailyOpeningHours" },
        },
      },
      VendorAvailability: {
        type: "object",
        properties: {
          isAvailable: {
            type: "boolean",
          },
          isOpenNow: {
            type: "boolean",
          },
          isReceivingOrders: {
            type: "boolean",
          },
          approvalStatus: {
            $ref: "#/components/schemas/VendorApprovalStatus",
          },
          openingHours: {
            $ref: "#/components/schemas/VendorOpeningHours",
          },
        },
      },
      VendorAvailabilityUpdateRequest: {
        type: "object",
        properties: {
          isAvailable: {
            type: "boolean",
          },
          openingHours: {
            $ref: "#/components/schemas/VendorOpeningHours",
          },
        },
      },
      VendorAvailabilityResponse: {
        type: "object",
        properties: {
          status: {
            type: "string",
            example: "ok",
          },
          message: {
            type: "string",
            example: "Vendor availability fetched successfully",
          },
          data: {
            type: "object",
            properties: {
              availability: {
                $ref: "#/components/schemas/VendorAvailability",
              },
            },
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
      CloudinaryUploadSignatureRequest: {
        type: "object",
        required: ["assetType"],
        properties: {
          assetType: {
            type: "string",
            enum: [
              "vendorDocument",
              "vendorBusinessLogo",
              "mealImage",
              "customerProfileImage",
            ],
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
          location: {
            type: "object",
            description:
              "GeoJSON point kept in sync with latitude/longitude, indexed with a 2dsphere index for radius search.",
            properties: {
              type: { type: "string", enum: ["Point"] },
              coordinates: {
                type: "array",
                items: { type: "number" },
                description: "[longitude, latitude]",
                example: [3.3538, 6.5005],
              },
            },
          },
          isDefault: { type: "boolean" },
        },
      },
      SearchRadius: {
        type: "object",
        description:
          "Metadata describing the location filter applied to a meal/vendor list.",
        properties: {
          strategy: {
            type: "string",
            enum: ["radius", "none"],
            description:
              "`radius` when results are filtered to the customer's area; `none` when no usable customer address is available and the unfiltered result set is returned.",
          },
          radiusKm: {
            type: "number",
            nullable: true,
            description:
              "Effective search width in kilometers (null when strategy is `none`).",
            example: 10,
          },
          customerAddress: {
            type: "object",
            nullable: true,
            description:
              "The customer address the radius was measured from (null when strategy is `none`).",
            properties: {
              id: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              country: { type: "string" },
              latitude: { type: "number" },
              longitude: { type: "number" },
            },
          },
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
          price: {
            type: "number",
            description: "Base meal price, excluding any customization.",
          },
          quantity: { type: "number" },
          effectiveUnitPrice: {
            type: "number",
            description: "Base price plus the resolved customization delta.",
          },
          totalPrice: {
            type: "number",
            description: "effectiveUnitPrice multiplied by quantity.",
          },
          customization: { $ref: "#/components/schemas/MealCustomization" },
        },
      },
      MealCustomizationSelection: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Must match an option name on the meal" },
          price: {
            type: "number",
            description:
              "Client-submitted price is ignored; the server always resolves the authoritative price from the meal's current options.",
          },
        },
      },
      MealCustomizationSelectionWithQuantity: {
        allOf: [
          { $ref: "#/components/schemas/MealCustomizationSelection" },
          {
            type: "object",
            properties: {
              quantity: { type: "number", minimum: 1, default: 1 },
            },
          },
        ],
      },
      MealCustomization: {
        type: "object",
        description:
          "A customer's selected packaging/protein/add-on/drink choices for a single meal line, plus any free-text custom requests and cooking instructions.",
        properties: {
          packaging: { $ref: "#/components/schemas/MealCustomizationSelection" },
          spiceLevel: {
            type: "string",
            enum: ["mild", "medium", "hot", "extra"],
          },
          proteinSelections: {
            type: "array",
            items: { $ref: "#/components/schemas/MealCustomizationSelectionWithQuantity" },
          },
          addOnSelections: {
            type: "array",
            items: { $ref: "#/components/schemas/MealCustomizationSelection" },
          },
          drinkSelections: {
            type: "array",
            items: { $ref: "#/components/schemas/MealCustomizationSelectionWithQuantity" },
          },
          customProteinRequests: {
            type: "array",
            items: { type: "string" },
            description:
              "Free-text protein requests not in the meal's protein list. No price — the vendor confirms availability/price manually.",
          },
          customAddOnRequests: {
            type: "array",
            items: { type: "string" },
            description: "Free-text add-on requests. No price — vendor confirms manually.",
          },
          customDrinkRequests: {
            type: "array",
            items: { type: "string" },
            description: "Free-text drink requests. No price — vendor confirms manually.",
          },
          cookingInstructions: {
            type: "object",
            properties: {
              presets: {
                type: "array",
                items: { type: "string" },
                description: "Selected quick-preference chips, e.g. 'No onions', 'Well-done'.",
              },
              note: {
                type: "string",
                maxLength: 500,
                description: "Free-text note to the chef.",
              },
            },
          },
        },
      },
      AddToCartRequest: {
        type: "object",
        properties: {
          quantity: { type: "number", minimum: 1, default: 1 },
          customization: {
            $ref: "#/components/schemas/MealCustomization",
            description:
              "Required to include a packaging selection when the meal has packaging options, and a protein selection (or customProteinRequests entry) when the meal has protein options.",
          },
        },
      },
      MealPlanFrequency: {
        type: "string",
        enum: ["daily", "weekdays", "weekends", "custom"],
      },
      MealPlanPortionSize: {
        type: "string",
        enum: ["small", "regular", "large"],
      },
      MealPlanPaymentType: {
        type: "string",
        enum: ["weekly", "monthly", "per_meal"],
      },
      MealPlanStatus: {
        type: "string",
        enum: ["active", "cancelled"],
      },
      ScheduledMealStatus: {
        type: "string",
        enum: ["scheduled", "cancelled", "completed"],
      },
      DeliveryTimeWindow: {
        type: "object",
        required: ["startTime", "endTime"],
        properties: {
          startTime: { type: "string", example: "12:00", description: "24h HH:mm" },
          endTime: { type: "string", example: "14:00", description: "24h HH:mm" },
        },
      },
      MealPlanCustomization: {
        type: "object",
        required: ["portionSize"],
        properties: {
          portionSize: { $ref: "#/components/schemas/MealPlanPortionSize" },
          note: {
            type: "string",
            maxLength: 500,
            description: "Free-text note to the chef, e.g. allergies or preferences",
          },
        },
      },
      MealPlan: {
        type: "object",
        properties: {
          _id: { type: "string" },
          customerId: { type: "string" },
          vendorId: {
            type: "string",
            nullable: true,
            description: "Set once the first meal is added to the plan; all meals in a plan must share one vendor.",
          },
          name: { type: "string" },
          frequency: { $ref: "#/components/schemas/MealPlanFrequency" },
          customDays: {
            type: "array",
            items: { type: "string" },
            description: "Weekday names, used when frequency is 'custom'",
          },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          deliveryTimeWindow: { $ref: "#/components/schemas/DeliveryTimeWindow" },
          defaultCustomization: { $ref: "#/components/schemas/MealPlanCustomization" },
          paymentType: { $ref: "#/components/schemas/MealPlanPaymentType" },
          status: { $ref: "#/components/schemas/MealPlanStatus" },
          currency: { type: "string", example: "NGN" },
          mealsScheduledCount: {
            type: "number",
            description: "Computed: count of non-cancelled scheduled meals in this plan",
          },
          totalAmount: {
            type: "number",
            description: "Computed: sum of price across non-cancelled scheduled meals",
          },
          estimatedTotal: {
            type: "number",
            description: "Computed: totalAmount with a 10% discount applied when paymentType is 'monthly'",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ScheduledMeal: {
        type: "object",
        properties: {
          _id: { type: "string" },
          planId: { type: "string" },
          customerId: { type: "string" },
          vendorId: { type: "string" },
          mealId: { type: "string" },
          mealName: { type: "string", description: "Snapshot of the meal name at scheduling time" },
          mealImageUrl: { type: "string" },
          price: { type: "number", description: "Snapshot of the meal price at scheduling time" },
          deliveryDate: { type: "string", format: "date-time" },
          deliveryTimeWindow: { $ref: "#/components/schemas/DeliveryTimeWindow" },
          customization: { $ref: "#/components/schemas/MealPlanCustomization" },
          status: { $ref: "#/components/schemas/ScheduledMealStatus" },
          cancelledAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreateMealPlanRequest: {
        type: "object",
        required: [
          "name",
          "frequency",
          "startDate",
          "endDate",
          "deliveryTimeWindow",
          "defaultCustomization",
          "paymentType",
        ],
        properties: {
          name: { type: "string", example: "Office Lunch Plan" },
          frequency: { $ref: "#/components/schemas/MealPlanFrequency" },
          customDays: {
            type: "array",
            items: { type: "string" },
            description: "Required when frequency is 'custom'",
          },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          deliveryTimeWindow: { $ref: "#/components/schemas/DeliveryTimeWindow" },
          defaultCustomization: { $ref: "#/components/schemas/MealPlanCustomization" },
          paymentType: { $ref: "#/components/schemas/MealPlanPaymentType" },
        },
      },
      UpdateMealPlanRequest: {
        type: "object",
        description: "All fields optional; at least one required. Only updates plan-level settings — does not regenerate or alter already-scheduled meals.",
        properties: {
          name: { type: "string" },
          frequency: { $ref: "#/components/schemas/MealPlanFrequency" },
          customDays: { type: "array", items: { type: "string" } },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          deliveryTimeWindow: { $ref: "#/components/schemas/DeliveryTimeWindow" },
          defaultCustomization: { $ref: "#/components/schemas/MealPlanCustomization" },
          paymentType: { $ref: "#/components/schemas/MealPlanPaymentType" },
        },
      },
      AddMealToPlanRequest: {
        type: "object",
        required: ["mealId"],
        properties: {
          mealId: { type: "string" },
          customization: {
            allOf: [{ $ref: "#/components/schemas/MealPlanCustomization" }],
            description: "Defaults to the plan's defaultCustomization when omitted",
          },
        },
      },
      UpdateScheduledMealRequest: {
        type: "object",
        description: "All fields optional; at least one required. Rejected with 400 if less than 12 hours remain before the current delivery date/time.",
        properties: {
          deliveryDate: { type: "string", format: "date" },
          deliveryTimeWindow: { $ref: "#/components/schemas/DeliveryTimeWindow" },
          customization: { $ref: "#/components/schemas/MealPlanCustomization" },
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
          useWallet: {
            type: "boolean",
            default: false,
            description:
              "If true, reserve available wallet balance first and charge Paystack for the remainder.",
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
            properties: {
              subtotal: { type: "number" },
              serviceCharge: {
                type: "number",
                description:
                  "Calculated service charge applied during checkout.",
              },
              deliveryFee: { type: "number" },
              taxAmount: { type: "number" },
              discountAmount: { type: "number" },
              totalAmount: { type: "number" },
              walletAmountApplied: {
                type: "number",
                description:
                  "Amount reserved/applied from wallet for this order.",
              },
              paystackAmountDue: {
                type: "number",
                description:
                  "Remaining amount charged through Paystack for this order.",
              },
            },
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
              amount: {
                type: "number",
                description:
                  "Amount to be charged by the selected provider (Paystack remainder for split payments).",
              },
              providerPayload: {
                type: "object",
                properties: {
                  split: {
                    type: "object",
                    properties: {
                      totalAmount: { type: "number" },
                      walletAmountApplied: { type: "number" },
                      paystackAmountDue: { type: "number" },
                    },
                  },
                },
              },
            },
          },
          preview: {
            type: "object",
            description: "Checkout snapshot used to create the order",
            properties: {
              pricing: {
                type: "object",
                properties: {
                  subtotal: { type: "number" },
                  serviceCharge: { type: "number" },
                  deliveryFee: { type: "number" },
                  taxAmount: { type: "number" },
                  discountAmount: { type: "number" },
                  totalAmount: { type: "number" },
                  walletAmountApplied: { type: "number" },
                  paystackAmountDue: { type: "number" },
                },
              },
            },
          },
        },
      },
      VendorApprovalStatus: {
        type: "string",
        enum: ["pending", "approved", "suspended", "rejected"],
      },
      PaymentSettlementStatus: {
        type: "string",
        enum: ["ineligible", "unsettled", "partially_paid", "paid", "reversed"],
      },
      VendorPayoutRequestStatus: {
        type: "string",
        enum: ["requested", "processing", "approved", "rejected"],
      },
      VendorPayoutRequestPaymentStatus: {
        type: "string",
        enum: ["unpaid", "paid"],
      },
      VendorPayoutRequestCreatePayload: {
        type: "object",
        required: ["amount"],
        properties: {
          amount: { type: "number", minimum: 0.01 },
          note: { type: "string" },
          bankName: { type: "string" },
          accountName: { type: "string" },
          accountNumber: { type: "string" },
        },
      },
      AdminVendorPayoutRequestUpdatePayload: {
        type: "object",
        properties: {
          status: { $ref: "#/components/schemas/VendorPayoutRequestStatus" },
          action: {
            type: "string",
            enum: ["approve", "reject", "process"],
            description:
              "Alias for `status` (approve→approved, reject→rejected, process→processing). Either may be used; `status` takes precedence if both are sent.",
          },
          paymentStatus: {
            $ref: "#/components/schemas/VendorPayoutRequestPaymentStatus",
          },
          approvedAmount: { type: "number", minimum: 0.01 },
          payoutReference: { type: "string" },
          note: { type: "string" },
          rejectionReason: { type: "string" },
          allocations: {
            type: "array",
            items: {
              type: "object",
              required: ["paymentId", "amount"],
              properties: {
                paymentId: { type: "string" },
                amount: { type: "number", minimum: 0.01 },
              },
            },
          },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "number" },
          limit: { type: "number" },
          total: { type: "number" },
          totalPages: { type: "number" },
        },
      },
      AdminAuditLog: {
        type: "object",
        properties: {
          _id: { type: "string" },
          adminUserId: {
            type: "object",
            description: "Populated with firstName, lastName, email",
          },
          action: { type: "string" },
          targetType: { type: "string" },
          targetId: { type: "string" },
          metadata: { type: "object" },
          ipAddress: { type: "string" },
          userAgent: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
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
