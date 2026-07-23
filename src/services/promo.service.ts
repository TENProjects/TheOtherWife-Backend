/** @format */

import { ClientSession } from "mongoose";
import type { OrderDocument } from "../models/order.model.js";
import PromoCampaign from "../models/promoCampaign.model.js";
import Wallet from "../models/wallet.model.js";
import WalletTransaction from "../models/walletTransaction.model.js";

type PromoCreditResult = {
  awarded: boolean;
  reason?:
    | "order_not_paid"
    | "order_not_eligible"
    | "campaign_inactive"
    | "campaign_not_started"
    | "campaign_ended"
    | "cap_reached"
    | "already_awarded";
};

export class PromoService {
  private static readonly first100PaidOver15000CampaignCode =
    "FIRST_100_PAID_ORDERS_OVER_15000_GET_2000";

  private ensureDefaultPromoCampaign = async (session: ClientSession) => {
    return await PromoCampaign.findOneAndUpdate(
      { code: PromoService.first100PaidOver15000CampaignCode },
      {
        $setOnInsert: {
          name: "First 100 Paid Orders Over 15,000 Get 2,000",
          description:
            "Credits customer wallet with 2,000 NGN after webhook-confirmed payment for eligible orders.",
          isActive: true,
          rewardAmount: 2000,
          minOrderAmount: 15000,
          maxAwardCount: 100,
          awardedCount: 0,
          currency: "NGN",
        },
      },
      { new: true, upsert: true, session },
    );
  };

  creditEligiblePaidOrder = async (
    session: ClientSession,
    order: OrderDocument,
  ): Promise<PromoCreditResult> => {
    if (order.status !== "paid" || order.paymentStatus !== "paid") {
      return { awarded: false, reason: "order_not_paid" };
    }

    const campaign = await this.ensureDefaultPromoCampaign(session);

    if (!campaign.isActive) {
      return { awarded: false, reason: "campaign_inactive" };
    }

    const now = new Date();
    if (campaign.startsAt && campaign.startsAt > now) {
      return { awarded: false, reason: "campaign_not_started" };
    }

    if (campaign.endsAt && campaign.endsAt <= now) {
      return { awarded: false, reason: "campaign_ended" };
    }

    // "Above 15,000" means strictly greater than min order amount.
    if (order.subtotal <= campaign.minOrderAmount) {
      return { awarded: false, reason: "order_not_eligible" };
    }

    const wallet = await Wallet.findOneAndUpdate(
      { userId: order.customerId },
      {
        $setOnInsert: {
          userId: order.customerId,
          walletType: "promo",
          currency: campaign.currency,
          availableBalance: 0,
          withdrawable: false,
        },
      },
      { new: true, upsert: true, session },
    );

    const orderReferenceId = order._id.toString();
    const claimResult = await WalletTransaction.updateOne(
      {
        userId: order.customerId,
        transactionType: "promo_earn",
        promoCampaignId: campaign._id,
      },
      {
        $setOnInsert: {
          walletId: wallet._id,
          userId: order.customerId,
          walletType: "promo",
          transactionType: "promo_earn",
          amount: campaign.rewardAmount,
          currency: campaign.currency,
          status: "posted",
          referenceType: "order",
          referenceId: orderReferenceId,
          promoCampaignId: campaign._id,
          metadata: {
            campaignCode: campaign.code,
            orderSubtotal: order.subtotal,
          },
        },
      },
      { upsert: true, session },
    );

    if (claimResult.upsertedCount === 0) {
      return { awarded: false, reason: "already_awarded" };
    }

    const claimedCampaign = await PromoCampaign.findOneAndUpdate(
      {
        _id: campaign._id,
        isActive: true,
        awardedCount: { $lt: campaign.maxAwardCount },
      },
      {
        $inc: {
          awardedCount: 1,
        },
      },
      { new: true, session },
    );

    if (!claimedCampaign) {
      await WalletTransaction.deleteOne({
        _id: claimResult.upsertedId,
      }).session(session);
      return { awarded: false, reason: "cap_reached" };
    }

    wallet.availableBalance += claimedCampaign.rewardAmount;
    await wallet.save({ session });

    return { awarded: true };
  };
}
