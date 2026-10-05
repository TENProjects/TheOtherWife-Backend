/** @format */

// One pagination contract for every referral/partner admin list:
//   request:  ?page=1&limit=20   (limit 1–100; validated by zod at the route)
//   response: { items: [...], pagination: { page, limit, total, totalPages } }

export type Pagination = { page?: number; limit?: number };

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const paginate = ({ page = 1, limit = DEFAULT_PAGE_LIMIT }: Pagination = {}) => {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const safePage = Math.max(Math.trunc(page) || 1, 1);
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

export const paginationResult = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(Math.ceil(total / limit), 1),
});
