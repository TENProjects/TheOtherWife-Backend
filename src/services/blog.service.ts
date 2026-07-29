/** @format */

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import BlogPost, { BlogPostStatus } from "../models/blogPost.model.js";

export class BlogService {
  private slugify = (title: string): string =>
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "post";

  private generateUniqueSlug = async (
    title: string,
    excludePostId?: string,
  ): Promise<string> => {
    const base = this.slugify(title);
    let slug = base;
    let suffix = 1;

    // Small collision space in practice (admin-authored posts only), so a
    // simple incrementing suffix loop is sufficient.
    while (
      await BlogPost.exists({
        slug,
        ...(excludePostId ? { _id: { $ne: excludePostId } } : {}),
      })
    ) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }

    return slug;
  };

  private escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  getAllPostsForAdmin = async (
    filters: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => {
    const { search, status, page = 1, limit = 50 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    const query: Record<string, any> = {};

    if (status) {
      const normalizedStatus = status.trim().toLowerCase();
      if (!["draft", "published", "archived"].includes(normalizedStatus)) {
        throw new BadRequestException(
          "Invalid status filter",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      query.status = normalizedStatus;
    }

    if (search && search.trim()) {
      const regex = new RegExp(this.escapeRegex(search.trim()), "i");
      query.$or = [{ title: regex }, { content: regex }];
    }

    const [posts, total, statusCounts, viewsAgg] = await Promise.all([
      BlogPost.find(query)
        .populate("authorId", "firstName lastName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      BlogPost.countDocuments(query),
      BlogPost.aggregate<{ _id: BlogPostStatus; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      BlogPost.aggregate<{ _id: null; totalViews: number }>([
        { $group: { _id: null, totalViews: { $sum: "$views" } } },
      ]),
    ]);

    const stats = { published: 0, draft: 0, archived: 0 };
    statusCounts.forEach((entry) => {
      if (entry._id in stats) {
        stats[entry._id] = entry.count;
      }
    });

    return {
      posts: posts.map((post) => {
        const postObject = post.toObject() as any;
        const author = postObject.authorId;
        return {
          _id: postObject._id.toString(),
          title: postObject.title,
          slug: postObject.slug,
          category: postObject.category,
          featuredImageUrl: postObject.featuredImageUrl ?? null,
          content: postObject.content,
          quote: postObject.quote ?? null,
          status: postObject.status,
          author: author
            ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim()
            : "Unknown",
          views: postObject.views,
          createdAt: postObject.createdAt,
          updatedAt: postObject.updatedAt,
        };
      }),
      stats: {
        publishedPosts: stats.published,
        drafts: stats.draft,
        archived: stats.archived,
        totalViews: viewsAgg[0]?.totalViews ?? 0,
      },
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  getPostByIdForAdmin = async (postId: string) => {
    const post = await BlogPost.findById(postId).populate(
      "authorId",
      "firstName lastName",
    );

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { post };
  };

  createPost = async (
    authorId: string,
    body: {
      title: string;
      category?: string;
      featuredImageUrl?: string;
      content: string;
      quote?: string;
      status: "draft" | "published";
    },
  ) => {
    const slug = await this.generateUniqueSlug(body.title);

    const post = await BlogPost.create({
      title: body.title,
      slug,
      category: body.category,
      featuredImageUrl: body.featuredImageUrl,
      content: body.content,
      quote: body.quote,
      status: body.status,
      authorId,
      views: 0,
      publishedAt: body.status === "published" ? new Date() : undefined,
    });

    return { post };
  };

  updatePost = async (
    postId: string,
    body: {
      title?: string;
      category?: string;
      featuredImageUrl?: string;
      content?: string;
      quote?: string;
      status?: "draft" | "published" | "archived";
    },
  ) => {
    const post = await BlogPost.findById(postId);

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (body.title !== undefined && body.title !== post.title) {
      post.title = body.title;
      post.slug = await this.generateUniqueSlug(body.title, postId);
    }
    if (body.category !== undefined) {
      post.category = body.category;
    }
    if (body.featuredImageUrl !== undefined) {
      post.featuredImageUrl = body.featuredImageUrl;
    }
    if (body.content !== undefined) {
      post.content = body.content;
    }
    if (body.quote !== undefined) {
      post.quote = body.quote;
    }
    if (body.status !== undefined) {
      if (body.status === "published" && post.status !== "published") {
        post.publishedAt = new Date();
      }
      post.status = body.status;
    }

    await post.save();

    return { post };
  };

  toggleVisibility = async (postId: string) => {
    const post = await BlogPost.findById(postId);

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (post.status === "published") {
      post.status = "draft";
    } else {
      post.status = "published";
      if (!post.publishedAt) {
        post.publishedAt = new Date();
      }
    }

    await post.save();

    return { post };
  };

  archivePost = async (postId: string) => {
    const post = await BlogPost.findByIdAndUpdate(
      postId,
      { $set: { status: "archived" } },
      { new: true },
    );

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { post };
  };

  deletePost = async (postId: string) => {
    const post = await BlogPost.findByIdAndDelete(postId);

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
  };

  private formatAuthorName = (
    author: { firstName?: string; lastName?: string } | null | undefined,
  ): string =>
    author
      ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim()
      : "TheOtherWife Team";

  // content is HTML (RichTextEditor output, restricted to the p/h2/h3/
  // strong/em/br allowlist enforced at save time) - both read-time and the
  // excerpt need the plain text underneath it, not the markup.
  private stripHtml = (content: string): string =>
    content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  // ~200 words/minute, matching the "X min read" badge shown on the public
  // blog — derived from content rather than stored, so it never goes stale
  // after an edit.
  private estimateReadTime = (content: string): string => {
    const wordCount = this.stripHtml(content).split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(wordCount / 200));
    return `${minutes} min read`;
  };

  // Plain-text teaser for the post-card grid — strips the excerpt to a clean
  // word boundary rather than cutting mid-word.
  private excerpt = (content: string, maxLength = 160): string => {
    const plain = this.stripHtml(content);
    if (plain.length <= maxLength) return plain;
    const truncated = plain.slice(0, maxLength);
    return `${truncated.slice(0, truncated.lastIndexOf(" "))}...`;
  };

  // Public, unauthenticated — only ever returns published posts. Drafts and
  // archived posts must never leak here. Shape matches the public blog's
  // card-grid pattern (title/slug/category/image/description/author/
  // readTime/publishedAt) so a frontend integration can consume it directly.
  getPublishedPosts = async (
    filters: { page?: number; limit?: number } = {},
  ) => {
    const { page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);

    const query = { status: "published" as const };

    const [posts, total] = await Promise.all([
      BlogPost.find(query)
        .populate("authorId", "firstName lastName")
        .select("title slug category featuredImageUrl content quote views publishedAt")
        .sort({ publishedAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      BlogPost.countDocuments(query),
    ]);

    return {
      posts: posts.map((post) => {
        const postObject = post.toObject() as any;
        return {
          title: postObject.title,
          slug: postObject.slug,
          category: postObject.category,
          image: postObject.featuredImageUrl ?? null,
          description: this.excerpt(postObject.content),
          author: this.formatAuthorName(postObject.authorId),
          readTime: this.estimateReadTime(postObject.content),
          views: postObject.views,
          publishedAt: postObject.publishedAt,
        };
      }),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      },
    };
  };

  // Public, unauthenticated. Increments the view counter on every fetch —
  // a simple counter with no dedup, matching the admin dashboard's
  // "Total Views" stat. Shape matches the public blog's article-page pattern
  // (adds category/readTime/content on top of the list shape).
  getPublishedPostBySlug = async (slug: string) => {
    const post = await BlogPost.findOneAndUpdate(
      { slug, status: "published" },
      { $inc: { views: 1 } },
      { new: true },
    ).populate("authorId", "firstName lastName");

    if (!post) {
      throw new NotFoundException(
        "Blog post not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const postObject = post.toObject() as any;

    return {
      post: {
        title: postObject.title,
        slug: postObject.slug,
        category: postObject.category,
        image: postObject.featuredImageUrl ?? null,
        content: postObject.content,
        quote: postObject.quote ?? null,
        author: this.formatAuthorName(postObject.authorId),
        readTime: this.estimateReadTime(postObject.content),
        views: postObject.views,
        publishedAt: postObject.publishedAt,
      },
    };
  };
}
