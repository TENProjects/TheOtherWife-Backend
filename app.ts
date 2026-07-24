/** @format */

import express, { Express } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import redoc from "redoc-express";
import helmet from "helmet";
import cors from "cors";

import { errorHandler } from "./src/middlewares/error-handler.middleware.js";
import { sanitizeQueryAndParams } from "./src/middlewares/sanitize-query.middleware.js";

import { corsOrigin, hostName, port } from "./src/constants/env.js";
import { Db } from "./src/config/db.config.js";
import { swaggerSpec } from "./src/config/swagger.config.js";

import { authRouter } from "./src/routes/auth.route.js";
import { userRouter } from "./src/routes/user.route.js";
import { addressRouter } from "./src/routes/address.route.js";
import { customerRouter } from "./src/routes/customer.route.js";
import { vendorRouter } from "./src/routes/vendor.route.js";
import { cartRouter } from "./src/routes/cart.route.js";
import { HttpStatus } from "./src/config/http.config.js";
import { mealRouter } from "./src/routes/meal.route.js";
import { getTemplate } from "./src/util/get-template.util.js";
import { checkoutRouter } from "./src/routes/checkout.route.js";
import { paymentRouter } from "./src/routes/payment.route.js";
import { orderRouter } from "./src/routes/order.route.js";
import { vendorOnboardingRouter } from "./src/routes/vendor-onboarding.route.js";
import { uploadRouter } from "./src/routes/upload.route.js";
import { walletRouter } from "./src/routes/wallet.route.js";
import { analyticsRouter } from "./src/routes/analytics.route.js";
import { vendorWalletRouter } from "./src/routes/vendor-wallet.route.js";
import { adminVendorPayoutRouter } from "./src/routes/admin-vendor-payout.route.js";
import { adminAuditLogRouter } from "./src/routes/admin-audit-log.route.js";
import { adminFinancialsRouter } from "./src/routes/admin-financials.route.js";
import { adminRefundRequestRouter } from "./src/routes/admin-refund-request.route.js";
import { adminUserDirectoryRouter } from "./src/routes/admin-user-directory.route.js";
import { adminBlogRouter } from "./src/routes/admin-blog.route.js";
import { blogRouter } from "./src/routes/blog.route.js";
import { adminVendorRelationsRouter } from "./src/routes/admin-vendor-relations.route.js";
import { favouriteRouter } from "./src/routes/favourite.route.js";
import { mealPlanRouter } from "./src/routes/meal-plan.route.js";
import { adminPromoCodeRouter } from "./src/routes/admin-promo-code.route.js";
import { adminMealPlanRouter } from "./src/routes/admin-meal-plan.route.js";
import { internalCronRouter } from "./src/routes/internal-cron.route.js";
import { supportTicketRouter } from "./src/routes/support-ticket.route.js";
import { vendorSupportTicketRouter } from "./src/routes/vendor-support-ticket.route.js";
import { adminSupportTicketRouter } from "./src/routes/admin-support-ticket.route.js";
import { adminReviewRouter } from "./src/routes/admin-review.route.js";
import { adminUserManagementRouter } from "./src/routes/admin-user-management.route.js";
import { adminCmsRouter } from "./src/routes/admin-cms.route.js";
import { cmsRouter } from "./src/routes/cms.route.js";
import { notificationRouter } from "./src/routes/notification.route.js";
import { adminNotificationRouter } from "./src/routes/admin-notification.route.js";
import "./src/signals/push-notification.signal.js";

export class App {
  app: Express;
  db: Db;

  constructor() {
    this.app = express();
    this.app.set("trust proxy", 1);
    this.app.disable("x-powered-by");
    this.db = new Db();
    this.initiializeMiddlewares();
    this.initializeRoutes();
  }

  initiializeMiddlewares() {
    const corsOptions = {
      origin: corsOrigin?.length ? corsOrigin : true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    };

    this.app.use(cors(corsOptions));
    this.app.options(/.*/, cors(corsOptions));

    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              "https://cdn.jsdelivr.net",
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null,
          },
        },
      }),
    );
    this.app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as express.Request).rawBody = buf.toString("utf8");
        },
      }),
    );
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(sanitizeQueryAndParams);
    this.app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        validate: {
          xForwardedForHeader: false,
        },
      }),
    );
  }

  async initializeDb() {
    await this.db.connect();
  }

  initializeRoutes() {
    this.app.get("/", (_req, res) => {
      res.status(HttpStatus.OK).send("Welcome to The Other Wife API");
    });

    this.app.use("/api/v1/auth", authRouter);
    this.app.use("/api/v1/users", userRouter);
    this.app.use("/api/v1/addresses", addressRouter);
    this.app.use("/api/v1/customers", customerRouter);
    this.app.use("/api/v1/vendors", vendorRouter);
    this.app.use("/api/v1/vendor-onboarding", vendorOnboardingRouter);
    this.app.use("/api/v1/uploads", uploadRouter);
    this.app.use("/api/v1/carts", cartRouter);
    this.app.use("/api/v1/meals", mealRouter);
    this.app.use("/api/v1/checkout", checkoutRouter);
    this.app.use("/api/v1/orders", orderRouter);
    this.app.use("/api/v1/payments", paymentRouter);
    this.app.use("/api/v1/wallet", walletRouter);
    this.app.use("/api/v1/vendor-wallet", vendorWalletRouter);
    this.app.use("/api/v1/admin/vendor-payout-requests", adminVendorPayoutRouter);
    this.app.use("/api/v1/admin/audit-logs", adminAuditLogRouter);
    this.app.use("/api/v1/admin/financials", adminFinancialsRouter);
    this.app.use("/api/v1/admin/refund-requests", adminRefundRequestRouter);
    this.app.use("/api/v1/admin/user-directory", adminUserDirectoryRouter);
    this.app.use("/api/v1/admin/blog-posts", adminBlogRouter);
    this.app.use("/api/v1/blog-posts", blogRouter);
    this.app.use(
      "/api/v1/admin/vendor-relations",
      adminVendorRelationsRouter,
    );
    this.app.use("/api/v1/analytics", analyticsRouter);
    this.app.use("/api/v1/favourites", favouriteRouter);
    this.app.use("/api/v1/meal-plans", mealPlanRouter);
    this.app.use("/api/v1/admin/promo-codes", adminPromoCodeRouter);
    this.app.use("/api/v1/admin/meal-plans", adminMealPlanRouter);
    this.app.use("/api/v1/internal/cron", internalCronRouter);
    this.app.use("/api/v1/support-tickets", supportTicketRouter);
    this.app.use("/api/v1/vendor/support-tickets", vendorSupportTicketRouter);
    this.app.use(
      "/api/v1/admin/support-tickets",
      adminSupportTicketRouter,
    );
    this.app.use("/api/v1/admin/reviews", adminReviewRouter);
    this.app.use("/api/v1/admin/users", adminUserManagementRouter);
    this.app.use("/api/v1/admin/cms", adminCmsRouter);
    this.app.use("/api/v1/cms", cmsRouter);
    this.app.use("/api/v1/notifications", notificationRouter);
    this.app.use("/api/v1/admin/notifications", adminNotificationRouter);

    this.app.get("/api-docs", async (_req, res) => {
      try {
        const template = await getTemplate(
          "src/templates",
          "swagger.template.html",
        );
        res.send(`${template}`);
      } catch (error: any) {
        res
          .status(HttpStatus.NOT_FOUND)
          .send(`Error reading template ${error.message}`);
      }
    });

    this.app.get(
      "/redoc",
      redoc({
        title: "The Other Wife API Docs",
        specUrl: "/api-docs.json",
      }),
    );
    this.app.get("/api-docs.json", (_req, res) => {
      res.json(swaggerSpec);
    });

    this.app.use(errorHandler);
  }

  async startServer() {
    await this.initializeDb();
    this.app.listen(port, () => {
      console.log(`Server is running on ${hostName}:${port}`);
    });
  }
}

const appInstance = new App();
const app = appInstance.app;

if (import.meta.url === `file://${process.argv[1]}`) {
  appInstance.startServer();
}

export default app;
export { app };
