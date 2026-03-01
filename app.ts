/** @format */

import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import redoc from "redoc-express";
import helmet from "helmet";

import { fileURLToPath } from "node:url";
import path, { dirname } from "node:path";
import fs from "node:fs/promises";

import { errorHandler } from "./src/middlewares/error-handler.middleware.js";

import { hostName, port, corsOrigin } from "./src/constants/constants.js";
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
    this.app.use(helmet());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(
      cors({
        origin: corsOrigin || true,
        credentials: true,
      }),
    );
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

    this.app.use(async (_req, _res, next) => {
      try {
        await this.db.connect();
        next();
      } catch (error) {
        next(error);
      }
    });
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
    this.app.use("/api/v1/carts", cartRouter);
    this.app.use("/api/v1/meals", mealRouter);

    this.app.get("/api-docs", async (req, res) => {
      const filePath = fileURLToPath(import.meta.url);
      const _dirname = dirname(filePath);
      const templatePath = path.join(
        _dirname,
        "src/util/",
        "swagger-template.util.html",
      );

      try {
        const template = await fs.readFile(templatePath, "utf-8");
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
