/** @format */

import HomeChefApplication, {
  HomeChefApplicationDocument,
} from "../models/homeChefApplication.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { nextSequence } from "../util/counter.util.js";

type Pagination = { page?: number; limit?: number };

const paginate = ({ page = 1, limit = 20 }: Pagination) => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 1);
  return { safeLimit, safePage, skip: (safePage - 1) * safeLimit };
};

const buildPaginationResult = (
  safePage: number,
  safeLimit: number,
  total: number,
) => ({
  page: safePage,
  limit: safeLimit,
  total,
  totalPages: Math.max(Math.ceil(total / safeLimit), 1),
});

type ApplicationFilters = { status?: string; search?: string };

const buildQuery = (filters: ApplicationFilters): Record<string, unknown> => {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    query.$or = [
      { fullName: { $regex: filters.search, $options: "i" } },
      { email: { $regex: filters.search, $options: "i" } },
      { applicationNumber: { $regex: filters.search, $options: "i" } },
    ];
  }
  return query;
};

const CSV_COLUMNS: Array<[string, keyof HomeChefApplicationDocument | "reviewedAtLabel"]> = [
  ["Application #", "applicationNumber"],
  ["Full Name", "fullName"],
  ["Email", "email"],
  ["WhatsApp", "whatsapp"],
  ["Location", "location"],
  ["Cuisine", "cuisine"],
  ["Hygiene Cert", "hygieneCert"],
  ["Capacity", "capacity"],
  ["Social Link", "socialLink"],
  ["Bio", "bio"],
  ["Status", "status"],
  ["Admin Notes", "adminNotes"],
];

// RFC4180 — quote a field whenever it contains a comma, quote, or newline,
// doubling any embedded quotes.
const csvEscape = (value: unknown): string => {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export class HomeChefApplicationService {
  createApplication = async (
    payload: Partial<HomeChefApplicationDocument>,
  ) => {
    const seq = await nextSequence("homeChefApplication");
    const applicationNumber = `HC${String(seq).padStart(3, "0")}`;

    return HomeChefApplication.create({
      ...payload,
      applicationNumber,
      status: "new",
    });
  };

  getApplications = async (filters: Pagination & ApplicationFilters) => {
    const { safeLimit, safePage, skip } = paginate(filters);
    const query = buildQuery(filters);

    const [applications, total] = await Promise.all([
      HomeChefApplication.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      HomeChefApplication.countDocuments(query),
    ]);

    return {
      applications,
      pagination: buildPaginationResult(safePage, safeLimit, total),
    };
  };

  getApplicationById = async (id: string) => {
    const application = await HomeChefApplication.findById(id);
    if (!application) {
      throw new NotFoundException(
        "Application not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return application;
  };

  updateStatus = async (
    adminUserId: string,
    id: string,
    payload: { status?: string; adminNotes?: string },
  ) => {
    const application = await this.getApplicationById(id);

    if (payload.status) {
      application.status = payload.status as HomeChefApplicationDocument["status"];
      application.reviewedBy = adminUserId as any;
      application.reviewedAt = new Date();
    }
    if (payload.adminNotes !== undefined) {
      application.adminNotes = payload.adminNotes;
    }

    await application.save();
    return application;
  };

  exportToCsv = async (filters: ApplicationFilters): Promise<string> => {
    const query = buildQuery(filters);
    const applications = await HomeChefApplication.find(query).sort({
      createdAt: -1,
    });

    const header = [...CSV_COLUMNS.map(([label]) => label), "Applied At", "Reviewed At"]
      .map(csvEscape)
      .join(",");

    const rows = applications.map((application) => {
      const cells = CSV_COLUMNS.map(([, field]) => csvEscape(application[field as keyof HomeChefApplicationDocument]));
      cells.push(csvEscape(application.createdAt.toISOString()));
      cells.push(csvEscape(application.reviewedAt ? application.reviewedAt.toISOString() : ""));
      return cells.join(",");
    });

    return [header, ...rows].join("\n");
  };
}
