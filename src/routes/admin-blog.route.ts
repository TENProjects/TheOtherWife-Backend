/** @format */

import { Router } from "express";
import { BlogController } from "../controllers/blog.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleGuardMiddleware } from "../middlewares/role-guard.middleware.js";
import { zodValidation } from "../middlewares/validation.js";
import {
  createBlogPostSchema,
  updateBlogPostSchema,
} from "../zod-schema/blog.schema.js";
import { uploadBlogFeaturedImage } from "../middlewares/file-upload.middleware.js";
import { uploadBlogFeaturedImageToCloudinary } from "../middlewares/cloudinary-upload.middleware.js";
import {
  adminRateLimitMiddleware,
  adminSensitiveActionRateLimitMiddleware,
} from "../middlewares/admin-rate-limit.middleware.js";

/**
 * @swagger
 * /api/v1/admin/blog-posts:
 *   get:
 *     summary: List blog posts for Content Management (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Matches against title or content
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [draft, published, archived]
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
 *           description: Max 100, default 50
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
 *                               _id: { type: string }
 *                               title: { type: string }
 *                               slug: { type: string }
 *                               featuredImageUrl: { type: string, nullable: true }
 *                               status: { type: string, enum: [draft, published, archived] }
 *                               author: { type: string }
 *                               views: { type: number }
 *                               createdAt: { type: string, format: date-time }
 *                               updatedAt: { type: string, format: date-time }
 *                         stats:
 *                           type: object
 *                           description: Computed across the full filtered result set, not just the current page
 *                           properties:
 *                             publishedPosts: { type: number }
 *                             drafts: { type: number }
 *                             archived: { type: number }
 *                             totalViews: { type: number }
 *                         pagination:
 *                           $ref: "#/components/schemas/Pagination"
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *   post:
 *     summary: Create a blog post (admin)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, content, status]
 *             properties:
 *               title: { type: string }
 *               featuredImageUrl: { type: string }
 *               featuredImage: { type: string, format: binary }
 *               content: { type: string }
 *               quote: { type: string, maxLength: 500 }
 *               status: { type: string, enum: [draft, published] }
 *     responses:
 *       "201":
 *         description: Blog post created successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 */

/**
 * @swagger
 * /api/v1/admin/blog-posts/{id}:
 *   get:
 *     summary: Get a blog post by id (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Blog post fetched successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   patch:
 *     summary: Update a blog post (admin)
 *     description: >-
 *       Send status "draft" for "Save as Draft" or "published" for
 *       "Update & Publish"/"Publish Now".
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               featuredImageUrl: { type: string }
 *               featuredImage: { type: string, format: binary }
 *               content: { type: string }
 *               quote: { type: string, maxLength: 500 }
 *               status: { type: string, enum: [draft, published, archived] }
 *     responses:
 *       "200":
 *         description: Blog post updated successfully
 *       "400":
 *         description: Bad request
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 *   delete:
 *     summary: Permanently delete a blog post (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "204":
 *         description: Blog post deleted successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/blog-posts/{id}/toggle-visibility:
 *   patch:
 *     summary: Toggle a post between published and draft (admin)
 *     description: Backs the "hide" action in the posts table — published becomes draft, and vice versa.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Blog post visibility updated successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

/**
 * @swagger
 * /api/v1/admin/blog-posts/{id}/archive:
 *   patch:
 *     summary: Archive a blog post (admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Blog post archived successfully
 *       "401":
 *         description: Unauthorized
 *       "403":
 *         description: Forbidden
 *       "404":
 *         description: Not found
 */

class AdminBlogRouter {
  private blogController: BlogController;
  router: Router;

  constructor() {
    this.blogController = new BlogController();
    this.router = Router();
    this.router.use(
      authMiddleware,
      roleGuardMiddleware(["admin"]),
      adminRateLimitMiddleware,
    );
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get("/", this.blogController.getAllPostsForAdmin);
    this.router.post(
      "/",
      uploadBlogFeaturedImage,
      uploadBlogFeaturedImageToCloudinary,
      zodValidation(createBlogPostSchema),
      this.blogController.createPost,
    );

    this.router.get("/:id", this.blogController.getPostByIdForAdmin);
    this.router.patch(
      "/:id",
      uploadBlogFeaturedImage,
      uploadBlogFeaturedImageToCloudinary,
      zodValidation(updateBlogPostSchema),
      this.blogController.updatePost,
    );
    this.router.delete(
      "/:id",
      adminSensitiveActionRateLimitMiddleware,
      this.blogController.deletePost,
    );

    this.router.patch(
      "/:id/toggle-visibility",
      this.blogController.toggleVisibility,
    );
    this.router.patch("/:id/archive", this.blogController.archivePost);
  }
}

export const adminBlogRouter = new AdminBlogRouter().router;
