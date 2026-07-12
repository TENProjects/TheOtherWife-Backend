/** @format */

import type { Request, Response } from "express";
import { HttpStatus } from "../config/http.config.js";
import { handleAsyncControl } from "../middlewares/handle-async-control.middleware.js";
import { BlogService } from "../services/blog.service.js";
import { ApiResponse } from "../util/response.util.js";
import { logAdminAction } from "../util/audit-log.util.js";

export class BlogController {
  private blogService: BlogService;

  constructor() {
    this.blogService = new BlogService();
  }

  getAllPostsForAdmin = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { search, status, page, limit } = req.query;
      const result = await this.blogService.getAllPostsForAdmin({
        search: search as string | undefined,
        status: status as string | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog posts fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getPostByIdForAdmin = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const result = await this.blogService.getPostByIdForAdmin(
        req.params.id,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog post fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  createPost = handleAsyncControl(
    async (
      req: Request<
        {},
        {},
        {
          title: string;
          featuredImageUrl?: string;
          content: string;
          quote?: string;
          status: "draft" | "published";
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.blogService.createPost(
        adminUserId,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "blog.post_create",
        targetType: "BlogPost",
        targetId: result.post._id.toString(),
        metadata: { title: req.body.title, status: req.body.status },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.CREATED).json({
        status: "ok",
        message: "Blog post created successfully",
        data: result,
      } as ApiResponse);
    },
  );

  updatePost = handleAsyncControl(
    async (
      req: Request<
        { id: string },
        {},
        {
          title?: string;
          featuredImageUrl?: string;
          content?: string;
          quote?: string;
          status?: "draft" | "published" | "archived";
        }
      >,
      res: Response,
    ): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.blogService.updatePost(
        req.params.id,
        req.body,
      );

      logAdminAction({
        adminUserId,
        action: "blog.post_update",
        targetType: "BlogPost",
        targetId: req.params.id,
        metadata: { status: req.body.status },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog post updated successfully",
        data: result,
      } as ApiResponse);
    },
  );

  toggleVisibility = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.blogService.toggleVisibility(req.params.id);

      logAdminAction({
        adminUserId,
        action: "blog.post_toggle_visibility",
        targetType: "BlogPost",
        targetId: req.params.id,
        metadata: { status: result.post.status },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog post visibility updated successfully",
        data: result,
      } as ApiResponse);
    },
  );

  archivePost = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      const result = await this.blogService.archivePost(req.params.id);

      logAdminAction({
        adminUserId,
        action: "blog.post_archive",
        targetType: "BlogPost",
        targetId: req.params.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog post archived successfully",
        data: result,
      } as ApiResponse);
    },
  );

  deletePost = handleAsyncControl(
    async (req: Request<{ id: string }>, res: Response): Promise<Response> => {
      const adminUserId = req.user?._id as unknown as string;
      await this.blogService.deletePost(req.params.id);

      logAdminAction({
        adminUserId,
        action: "blog.post_delete",
        targetType: "BlogPost",
        targetId: req.params.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(HttpStatus.NO_CONTENT).send();
    },
  );

  getPublishedPosts = handleAsyncControl(
    async (req: Request, res: Response): Promise<Response> => {
      const { page, limit } = req.query;
      const result = await this.blogService.getPublishedPosts({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog posts fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );

  getPublishedPostBySlug = handleAsyncControl(
    async (
      req: Request<{ slug: string }>,
      res: Response,
    ): Promise<Response> => {
      const result = await this.blogService.getPublishedPostBySlug(
        req.params.slug,
      );
      return res.status(HttpStatus.OK).json({
        status: "ok",
        message: "Blog post fetched successfully",
        data: result,
      } as ApiResponse);
    },
  );
}
