/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface OrderItem {
  mealId: mongoose.Types.ObjectId;
  mealName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
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
  deliveryFee: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  paidAt?: Date;
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
    status: {
      type: String,
      enum: [
        "pending_payment",
        "paid",
        "confirmed",
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
  },
  { timestamps: true },
);

export default model<OrderDocument>("Order", OrderSchema);
