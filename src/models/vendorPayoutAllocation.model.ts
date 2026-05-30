/** @format */

import mongoose, { Document, Schema, model } from "mongoose";

export interface VendorPayoutAllocationDocument extends Document {
  payoutRequestId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  allocatedAmount: number;
  currency: string;
}

const VendorPayoutAllocationSchema = new Schema(
  {
    payoutRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorPayoutRequest",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    allocatedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "NGN",
    },
  },
  { timestamps: true },
);

VendorPayoutAllocationSchema.index(
  { payoutRequestId: 1, paymentId: 1 },
  { unique: true },
);

export default model<VendorPayoutAllocationDocument>(
  "VendorPayoutAllocation",
  VendorPayoutAllocationSchema,
);
