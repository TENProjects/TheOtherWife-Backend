/** @format */

import mongoose, { ClientSession } from "mongoose";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import PromoCode, { PromoCodeDiscountType } from "../models/promoCode.model.js";

export class PromoCodeService {
  private computeDiscount = (
    discountType: PromoCodeDiscountType,
    discountValue: number,
    subtotal: number,
  ): number => {
    const raw =
      discountType === "percentage"
        ? Math.round((subtotal * discountValue) / 100)
        : discountValue;

    return Math.min(raw, subtotal);
  };

  // Read-only validation used by checkout preview — does NOT consume a use.
  validatePromoCode = async (
    code: string,
    subtotal: number,
    hasVendorDiscountInCart: boolean,
  ): Promise<{ promoCodeId: string; discountAmount: number }> => {
    if (hasVendorDiscountInCart) {
      throw new BadRequestException(
        "Promo code cannot be applied to items already on discount.",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const promoCode = await PromoCode.findOne({ code: code.trim().toUpperCase() });

    if (!promoCode) {
      throw new NotFoundException(
        "Promo code not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!promoCode.isActive) {
      throw new BadRequestException(
        "This promo code is no longer active",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (promoCode.expiresAt && promoCode.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        "This promo code has expired",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (promoCode.maxUses !== undefined && promoCode.usedCount >= promoCode.maxUses) {
      throw new BadRequestException(
        "This promo code has reached its usage limit",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    if (subtotal < promoCode.minOrderValue) {
      throw new BadRequestException(
        `This promo code requires a minimum order of ${promoCode.minOrderValue}`,
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const discountAmount = this.computeDiscount(
      promoCode.discountType,
      promoCode.discountValue,
      subtotal,
    );

    return { promoCodeId: promoCode._id.toString(), discountAmount };
  };

  // Same validation, plus an atomic usage increment — used at checkout
  // confirmation so redemptions are only consumed on an actual paid order,
  // never on a mere preview.
  redeemPromoCode = async (
    session: ClientSession,
    code: string,
    subtotal: number,
    hasVendorDiscountInCart: boolean,
  ): Promise<{ promoCodeId: string; discountAmount: number }> => {
    const { promoCodeId, discountAmount } = await this.validatePromoCode(
      code,
      subtotal,
      hasVendorDiscountInCart,
    );

    const filter: Record<string, unknown> = { _id: promoCodeId, isActive: true };
    const promoCode = await PromoCode.findOne(filter).session(session);
    if (!promoCode) {
      throw new NotFoundException(
        "Promo code not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const updateFilter: Record<string, unknown> = { _id: promoCodeId };
    if (promoCode.maxUses !== undefined) {
      updateFilter.usedCount = { $lt: promoCode.maxUses };
    }

    const updated = await PromoCode.findOneAndUpdate(
      updateFilter,
      { $inc: { usedCount: 1 } },
      { session, new: true },
    );

    if (!updated) {
      throw new BadRequestException(
        "This promo code has just reached its usage limit",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return { promoCodeId, discountAmount };
  };

  // ── Admin CRUD ───────────────────────────────────────────────────────────

  createPromoCode = async (
    payload: {
      code: string;
      discountType: PromoCodeDiscountType;
      discountValue: number;
      expiresAt?: Date;
      maxUses?: number;
      minOrderValue?: number;
    },
    adminUserId: string,
  ) => {
    const existing = await PromoCode.findOne({ code: payload.code.trim().toUpperCase() });
    if (existing) {
      throw new BadRequestException(
        "A promo code with this code already exists",
        HttpStatus.CONFLICT,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    return PromoCode.create({
      ...payload,
      code: payload.code.trim().toUpperCase(),
      minOrderValue: payload.minOrderValue ?? 0,
      createdBy: new mongoose.Types.ObjectId(adminUserId),
    });
  };

  getAdminPromoCodes = async () => {
    return PromoCode.find().sort({ createdAt: -1 });
  };

  getAdminPromoCodeById = async (id: string) => {
    const promoCode = await PromoCode.findById(id);
    if (!promoCode) {
      throw new NotFoundException(
        "Promo code not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return promoCode;
  };

  updatePromoCode = async (
    id: string,
    payload: {
      isActive?: boolean;
      discountValue?: number;
      expiresAt?: Date;
      maxUses?: number;
      minOrderValue?: number;
    },
  ) => {
    const promoCode = await PromoCode.findById(id);
    if (!promoCode) {
      throw new NotFoundException(
        "Promo code not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (payload.isActive !== undefined) promoCode.isActive = payload.isActive;
    if (payload.discountValue !== undefined) promoCode.discountValue = payload.discountValue;
    if (payload.expiresAt !== undefined) promoCode.expiresAt = payload.expiresAt;
    if (payload.maxUses !== undefined) promoCode.maxUses = payload.maxUses;
    if (payload.minOrderValue !== undefined) promoCode.minOrderValue = payload.minOrderValue;

    await promoCode.save();
    return promoCode;
  };
}
