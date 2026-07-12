/** @format */

import { Router } from "express";
import { BlogController } from "../controllers/blog.controller.js";

/**
 * @swagger
 * /api/v1/blog-posts:
 *   get:
 *     summary: List published blog posts (public)
 *     description: Unauthenticated. Only ever returns posts with status "published".
 *     tags: [Blog]
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: number
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *           description: Max 50, default 20
 *     responses:
 *       "200":
 *         description: Blog posts fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         posts:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               title: { type: string }
 *                               slug: { type: string }
 *                               featuredImageUrl: { type: string, nullable: true }
 *                               quote: { type: string, nullable: true }
 *                               author: { type: string }
 *                               views: { type: number }
 *                               publishedAt: { type: string, format: date-time }
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 */

/**
 * @swagger
 * /api/v1/blog-posts/{slug}:
 *   get:
 *     summary: Get a published blog post by slug (public)
 *     description: >-
 *       Unauthenticated. Only ever returns a post with status "published" —
 *       drafts and archived posts 404 rather than leaking. Increments the
 *       post's view counter on every fetch.
 *     tags: [Blog]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Blog post fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         post:
 *                           type: object
 *                           properties:
 *                             title: { type: string }
 *                             slug: { type: string }
 *                             featuredImageUrl: { type: string, nullable: true }
 *                             content: { type: string }
 *                             quote: { type: string, nullable: true }
 *                             author: { type: string }
 *                             views: { type: number }
 *                             publishedAt: { type: string, format: date-time }
 *       "404":
 *         description: Not found
 */

class BlogRouter {
  private blogController: BlogController;
  router: Router;

  constructor() {
    this.blogController = new BlogController();
    this.router = Router();
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.blogController.getPublishedPosts);
    this.router.get("/:slug", this.blogController.getPublishedPostBySlug);
  }
}

export const blogRouter = new BlogRouter().router;
