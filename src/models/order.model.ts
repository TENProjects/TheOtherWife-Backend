/** @format */

import mongoose, { Document, Schema, model } from "mongoose";
import type { MealCustomization } from "../util/meal-customization.util.js";

export interface OrderItem {
  mealId: mongoose.Types.ObjectId;
  mealName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  customization?: MealCustomization;
}

export interface OrderAddressSnapshot {
  label: "home" | "work" | "other";
  address?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

export interface OrderDocument extends Document {
  customerId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  cartId?: mongoose.Types.ObjectId;
  currency: string;
  items: OrderItem[];
  addressSnapshot: OrderAddressSnapshot;
  subtotal: number;
  serviceCharge: number;
  deliveryFee: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  walletAmountApplied: number;
  paystackAmountDue: number;
  status: string;
  paymentStatus: string;
  paidAt?: Date;
  deliveredAt?: Date;
}

const OrderSchema = new Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
      required: false,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
    items: [
      {
        mealId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Meal",
          required: true,
        },
        mealName: {
          type: String,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        unitPrice: {
          type: Number,
          required: true,
        },
        lineTotal: {
          type: Number,
          required: true,
        },
        customization: {
          type: {
            packaging: {
              name: { type: String },
              price: { type: Number },
            },
            spiceLevel: {
              type: String,
              enum: ["mild", "medium", "hot", "extra"],
            },
            proteinSelections: [
              {
                name: { type: String, required: true },
                price: { type: Number, required: true },
                quantity: { type: Number, default: 1 },
              },
            ],
            addOnSelections: [
              {
                name: { type: String, required: true },
                price: { type: Number, required: true },
              },
            ],
            drinkSelections: [
              {
                name: { type: String, required: true },
                price: { type: Number, required: true },
                quantity: { type: Number, default: 1 },
              },
            ],
            customProteinRequests: { type: [String], default: undefined },
            customAddOnRequests: { type: [String], default: undefined },
            customDrinkRequests: { type: [String], default: undefined },
            cookingInstructions: {
              presets: { type: [String], default: undefined },
              note: { type: String, maxlength: 500 },
            },
          },
          required: false,
          default: undefined,
          _id: false,
        },
      },
    ],
    addressSnapshot: {
      label: {
        type: String,
        enum: ["home", "work", "other"],
        required: true,
      },
      address: {
        type: String,
        required: false,
      },
      city: {
        type: String,
        required: true,
      },
      state: {
        type: String,
        required: true,
      },
      country: {
        type: String,
        required: true,
      },
      postalCode: {
        type: String,
        required: true,
      },
      latitude: {
        type: Number,
        required: true,
      },
      longitude: {
        type: Number,
        required: true,
      },
    },
    subtotal: {
      type: Number,
      required: true,
    },
    serviceCharge: {
      type: Number,
      required: true,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      required: true,
      default: 0,
    },
    taxAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    discountAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    walletAmountApplied: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    paystackAmountDue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "pending_payment",
        "paid",
        "confirmed",
        // Post-acceptance delivery progress — added for real-time order
        // tracking. "confirmed" remains the entry point set by the vendor's
        // accept endpoint; these three are set by the new preparing/
        // out-for-delivery/delivered vendor endpoints in that order.
        "preparing",
        "out_for_delivery",
        "delivered",
        "payment_failed",
        "customer_cancelled",
        "vendor_rejected",
        "expired",
      ],
      default: "pending_payment",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "succeeded", "failed", "expired", "refunded"],
      default: "pending",
    },
    paidAt: {
      type: Date,
      required: false,
    },
    deliveredAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true },
);

export default model<OrderDocument>("Order", OrderSchema);
