/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { MealPlanFulfillmentService } from "../services/meal-plan-fulfillment.service.js";
import { PaymentLedgerService } from "../services/payment-ledger.service.js";
import { AccountDeletionService } from "../services/account-deletion.service.js";
import { ApiResponse } from "../util/response.util.js";
import { partnerWebhookService } from "../services/partner-webhook.service.js";
import { orderPaymentService } from "../services/order-payment.service.js";
import { payoutTransferService } from "../services/payout-transfer.service.js";

export class InternalCronController {
  private mealPlanFulfillmentService: MealPlanFulfillmentService;
  private paymentLedgerService: PaymentLedgerService;
  private accountDeletionService: AccountDeletionService;

  constructor() {
    this.mealPlanFulfillmentService = new MealPlanFulfillmentService();
    this.paymentLedgerService = new PaymentLedgerService();
    this.accountDeletionService = new AccountDeletionService();
  }

  processDueMealPlanScheduledMeals = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.mealPlanFulfillmentService.processDueScheduledMeals();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Due scheduled meals processed successfully",
        data: result,
      } as ApiResponse);
    },
  );

  emitPaymentLedgerCheckpoint = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const checkpoint = await this.paymentLedgerService.emitCheckpoint();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: checkpoint
          ? "Payment ledger checkpoint emitted successfully"
          : "Payment ledger is empty — nothing to checkpoint",
        data: checkpoint,
      } as ApiResponse);
    },
  );

  // Settles automatic vendor payouts still waiting on the bank by asking
  // Paystack directly (backs up the transfer webhooks).
  reconcilePayoutTransfers = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await payoutTransferService.reconcilePendingTransfers();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: `Checked ${result.scanned} payout transfer(s)`,
        data: result,
      } as ApiResponse);
    },
  );

  runPartnerWebhooks = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await partnerWebhookService.run();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Partner status changes processed",
        data: result,
      } as ApiResponse);
    },
  );

  // Closes unpaid checkouts older than ORDER_PAYMENT_TTL_MINUTES after
  // verifying each with Paystack (a paid one is confirmed instead).
  // ?dryRun=1 reports what would happen without changing anything —
  // run that first after deploying.
  expireUnpaidOrders = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
      const limitRaw = Number(req.query.limit);
      const result = await orderPaymentService.expireStaleUnpaidOrders({
        dryRun,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: dryRun
          ? `Dry run: ${result.scanned} unpaid checkout(s) inspected, nothing changed`
          : `Expired ${result.expired}, confirmed ${result.confirmed} of ${result.scanned} unpaid checkout(s)`,
        data: result,
      } as ApiResponse);
    },
  );

  hardDeleteDueAccounts = handleAsyncControl(
    async (_req: Request, res: Response): Promise<Response> => {
      const result = await this.accountDeletionService.hardDeleteDueAccounts();
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: `Hard-deleted ${result.processed} account(s) past their grace period`,
        data: result,
      } as ApiResponse);
    },
  );
}
