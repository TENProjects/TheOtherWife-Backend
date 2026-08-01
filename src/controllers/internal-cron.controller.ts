/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { MealPlanFulfillmentService } from "../services/meal-plan-fulfillment.service.js";
import { PaymentLedgerService } from "../services/payment-ledger.service.js";
import { AccountDeletionService } from "../services/account-deletion.service.js";
import { ApiResponse } from "../util/response.util.js";

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
