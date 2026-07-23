/** @format */

import { Router } from "express";
import { SiteContentController } from "../controllers/site-content.controller.js";

/**
 * @swagger
 * /api/v1/cms:
 *   get:
 *     summary: Public read-only site content (About Us, contact email, contact phone)
 *     tags: [CMS]
 *     responses:
 *       "200":
 *         description: Site content fetched successfully
 */

class CmsRouter {
  router: Router;
  controller: SiteContentController;

  constructor() {
    this.router = Router();
    this.controller = new SiteContentController();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.controller.getContent);
  }
}

export const cmsRouter = new CmsRouter().router;
