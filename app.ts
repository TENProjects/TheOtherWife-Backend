/** @format */

import express, { Express } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import redoc from "redoc-express";
import helmet from "helmet";

import { errorHandler } from "./src/middlewares/error-handler.middleware.js";

import { hostName, port } from "./src/constants/env.js";
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

export class App {
  app: Express;
  db: Db;

  constructor() {
    this.app = express();
    this.app.set("trust proxy", 1);
    this.db = new Db();
    this.initiializeMiddlewares();
    this.initializeRoutes();
  }

  initiializeMiddlewares() {
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
    this.app.use("/api/v1/carts", cartRouter);
    this.app.use("/api/v1/meals", mealRouter);
    this.app.use("/api/v1/checkout", checkoutRouter);
    this.app.use("/api/v1/orders", orderRouter);
    this.app.use("/api/v1/payments", paymentRouter);

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
