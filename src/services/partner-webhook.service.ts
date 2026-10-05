/** @format */

import dns from "dns/promises";
import net from "net";
import mongoose from "mongoose";

import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { AppError } from "../errors/app.error.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";

import Partner from "../models/partner.model.js";
import PartnerSubmission, {
  PartnerSubmissionDocument,
} from "../models/partnerSubmission.model.js";
import PartnerWebhookDelivery from "../models/partnerWebhookDelivery.model.js";
import { PartnerIntegrationService } from "./partner-integration.service.js";
import { partnerQualificationService } from "./partner-qualification.service.js";
import { paginate, paginationResult } from "../util/pagination.util.js";

import {
  buildWebhookSigningString,
  generatePublicId,
  hmacSha256Hex,
} from "../util/referral.util.js";
import {
  generateSigningSecret,
  openSecret,
  sealSecret,
} from "../util/secret-box.util.js";

export const WEBHOOK_EVENT_STATUS_CHANGED = "submission.status_changed";
export const WEBHOOK_EVENT_PING = "ping";

// Delay before attempt n+1 after a failed attempt n (n = 1..6). After the 7th
// failed attempt (initial try + 6 retries, ~33h) the delivery is "failed".
export const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];
const MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 2 * 60_000;
const DETECT_BATCH = 200;
const DISPATCH_BATCH = 50;

type WebhookServiceOptions = {
  // Test-only: allow http:// and private/loopback targets (a local receiver).
  allowPrivateTargets?: boolean;
  fetchImpl?: typeof fetch;
};

// Private, loopback, link-local, CGNAT, multicast and reserved ranges that a
// partner webhook must never resolve to (server-side request forgery guard).
const blockedRanges = (() => {
  const list = new net.BlockList();
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  v4.forEach(([addr, prefix]) => list.addSubnet(addr, prefix, "ipv4"));
  const v6: Array<[string, number]> = [
    ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["::ffff:0:0", 96],
  ];
  v6.forEach(([addr, prefix]) => list.addSubnet(addr, prefix, "ipv6"));
  return list;
})();

const isBlockedAddress = (address: string, family: number) =>
  blockedRanges.check(address, family === 6 ? "ipv6" : "ipv4");

const notFound = (what: string) =>
  new NotFoundException(`${what} not found`, HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND);

const trimError = (value: unknown) =>
  String((value as Error)?.message ?? value ?? "Unknown error").slice(0, 500);

// Partner status webhooks.
//
// A status-checker job (run every few minutes by the internal cron route)
// compares each partner submission's current partner-facing status — derived
// by PartnerIntegrationService.describeSubmissions, the same logic the GET
// endpoints use — with the last status it recorded. On a change it records
// the new status (bumping updatedAt and statusSeq) and, if the partner has an
// enabled webhook, queues a signed event in PartnerWebhookDelivery. Nothing in
// the existing vendor / approval code is touched.
export class PartnerWebhookService {
  private integration = new PartnerIntegrationService();
  private allowPrivateTargets: boolean;
  private fetchImpl: typeof fetch;

  constructor(options: WebhookServiceOptions = {}) {
    this.allowPrivateTargets = options.allowPrivateTargets === true;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // ── Cron entry point ──────────────────────────────────────────────────

  // Partner tracking job (cron, every 5 minutes): successful-HomeChef
  // qualification, then status-change detection, then webhook delivery.
  run = async (options: { timeBudgetMs?: number } = {}) => {
    const budget = options.timeBudgetMs ?? 45_000;
    const start = Date.now();
    const deadline = start + budget;
    const qualification = await partnerQualificationService.evaluate(
      Math.min(deadline, start + Math.floor(budget / 3)),
    );
    const detection = await this.detectStatusChanges(deadline);
    const dispatch = await this.dispatchDue(deadline);
    return { ...qualification, ...detection, ...dispatch };
  };

  // ── Detection ─────────────────────────────────────────────────────────

  detectStatusChanges = async (deadline: number = Date.now() + 45_000) => {
    const webhookEnabled = new Map<string, boolean>();
    const partners = await Partner.find({ "webhook.enabled": true, status: "active" })
      .select("_id")
      .lean();
    partners.forEach((p) => webhookEnabled.set(String(p._id), true));

    let checked = 0;
    let changed = 0;
    let queued = 0;
    let baselined = 0;
    let lastId: mongoose.Types.ObjectId | null = null;

    while (Date.now() < deadline) {
      const batch: PartnerSubmissionDocument[] = await PartnerSubmission.find(
        lastId ? { _id: { $gt: lastId } } : {},
      )
        .select("-events")
        .sort({ _id: 1 })
        .limit(DETECT_BATCH);
      if (!batch.length) break;
      lastId = batch[batch.length - 1]._id as mongoose.Types.ObjectId;

      const described = await this.integration.describeSubmissions(batch);

      for (let i = 0; i < batch.length; i++) {
        const submission = batch[i];
        const current = described[i];
        checked += 1;
        const previous = submission.lastStatus;
        if (previous === current.status) continue;

        const now = new Date();

        // Rows created before status tracking existed: record silently.
        if (!previous) {
          const res = await PartnerSubmission.updateOne(
            { _id: submission._id, lastStatus: { $exists: false } },
            { $set: { lastStatus: current.status, lastStatusChangedAt: now } },
            { timestamps: false },
          );
          baselined += res.modifiedCount;
          continue;
        }

        const sequence = (submission.statusSeq ?? 0) + 1;

        // Queue first (unique on submissionId+sequence), then advance the
        // status conditionally. A crash between the two re-queues nothing
        // twice; overlapping runs collapse onto the same sequence.
        if (webhookEnabled.get(String(submission.partnerId))) {
          const eventId = generatePublicId("evt");
          const payload = {
            id: eventId,
            type: WEBHOOK_EVENT_STATUS_CHANGED,
            createdAt: now.toISOString(),
            data: {
              ...current,
              previousStatus: previous,
              sequence,
              updatedAt: now.toISOString(),
            },
          };
          try {
            await PartnerWebhookDelivery.create({
              eventId,
              partnerId: submission.partnerId,
              submissionId: submission._id,
              sequence,
              type: WEBHOOK_EVENT_STATUS_CHANGED,
              payload,
              nextAttemptAt: now,
            });
            queued += 1;
          } catch (error) {
            if ((error as { code?: number })?.code !== 11000) throw error;
            // This sequence was already queued — by an overlapping run, or by
            // a run that stopped before advancing the status. If it hasn't
            // been sent yet, make sure it carries the CURRENT status.
            const existing = await PartnerWebhookDelivery.findOne({
              submissionId: submission._id,
              sequence,
              status: "pending",
            });
            const queuedData = existing?.payload?.data as { status?: string } | undefined;
            if (existing && queuedData?.status !== current.status) {
              existing.payload = {
                ...payload,
                id: existing.eventId,
              };
              existing.markModified("payload");
              await existing.save();
            }
          }
        }

        const advanced = await PartnerSubmission.updateOne(
          { _id: submission._id, lastStatus: previous },
          {
            $set: {
              lastStatus: current.status,
              lastStatusChangedAt: now,
              statusSeq: sequence,
            },
            $push: {
              events: {
                type: "status_changed",
                at: now,
                actorType: "system",
                data: { from: previous, to: current.status, sequence },
              },
            },
          },
        );
        changed += advanced.modifiedCount;
      }
    }

    return { checked, changed, queued, baselined };
  };

  // ── Dispatch ──────────────────────────────────────────────────────────

  dispatchDue = async (deadline: number = Date.now() + 45_000) => {
    let delivered = 0;
    let retried = 0;
    let failed = 0;
    let cancelled = 0;

    while (Date.now() < deadline) {
      const now = new Date();
      const due = await PartnerWebhookDelivery.find({
        status: "pending",
        nextAttemptAt: { $lte: now },
      })
        .sort({ nextAttemptAt: 1, sequence: 1 })
        .limit(DISPATCH_BATCH)
        .select("_id nextAttemptAt")
        .lean();
      if (!due.length) break;

      for (const item of due) {
        if (Date.now() >= deadline) break;
        // Lease the delivery so a concurrent run doesn't send it too.
        const delivery = await PartnerWebhookDelivery.findOneAndUpdate(
          { _id: item._id, status: "pending", nextAttemptAt: item.nextAttemptAt },
          { $set: { nextAttemptAt: new Date(Date.now() + DELIVERY_LEASE_MS) } },
          { new: true },
        );
        if (!delivery) continue;

        const partner = await Partner.findById(delivery.partnerId)
          .select("+webhook.secretCiphertext")
          .lean();
        if (
          !partner ||
          partner.status !== "active" ||
          !partner.webhook?.enabled ||
          !partner.webhook.url ||
          !partner.webhook.secretCiphertext
        ) {
          await PartnerWebhookDelivery.updateOne(
            { _id: delivery._id },
            { $set: { status: "cancelled", lastError: "Partner webhook disabled or not configured" } },
          );
          cancelled += 1;
          continue;
        }

        const result = await this.send(
          partner.webhook.url,
          openSecret(partner.webhook.secretCiphertext),
          delivery.eventId,
          delivery.payload,
        );
        const attempts = delivery.attempts + 1;

        if (result.ok) {
          await PartnerWebhookDelivery.updateOne(
            { _id: delivery._id },
            {
              $set: {
                status: "delivered",
                attempts,
                lastAttemptAt: new Date(),
                lastResponseStatus: result.status,
                deliveredAt: new Date(),
              },
              $unset: { lastError: 1 },
            },
          );
          delivered += 1;
        } else if (attempts >= MAX_ATTEMPTS) {
          await PartnerWebhookDelivery.updateOne(
            { _id: delivery._id },
            {
              $set: {
                status: "failed",
                attempts,
                lastAttemptAt: new Date(),
                lastResponseStatus: result.status,
                lastError: result.error,
              },
            },
          );
          failed += 1;
        } else {
          await PartnerWebhookDelivery.updateOne(
            { _id: delivery._id },
            {
              $set: {
                attempts,
                lastAttemptAt: new Date(),
                lastResponseStatus: result.status,
                lastError: result.error,
                nextAttemptAt: new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[attempts - 1]),
              },
            },
          );
          retried += 1;
        }
      }
    }

    return { delivered, retried, failed, cancelled };
  };

  // Signs and POSTs one event. Never throws: returns the outcome.
  private send = async (
    url: string,
    secret: string,
    eventId: string,
    payload: unknown,
  ): Promise<{ ok: boolean; status?: number; error?: string }> => {
    try {
      await this.assertSafeTarget(url);
      const body = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = hmacSha256Hex(secret, buildWebhookSigningString(timestamp, body));
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TOW-Webhooks/1.0",
          "TOW-Webhook-Id": eventId,
          "TOW-Webhook-Timestamp": timestamp,
          "TOW-Signature": `v1=${signature}`,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Drain the body so the socket is released; content is ignored.
      await response.arrayBuffer().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status };
      }
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: trimError(error) };
    }
  };

  private assertSafeTarget = async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid webhook URL");
    }
    if (parsed.protocol !== "https:" && !(this.allowPrivateTargets && parsed.protocol === "http:")) {
      throw new Error("Webhook URL must use https");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Webhook URL must not contain credentials");
    }
    if (this.allowPrivateTargets) return;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address, a.family))) {
      throw new Error("Webhook URL resolves to a private or reserved address");
    }
  };

  // ── Admin operations ──────────────────────────────────────────────────

  private getPartnerWithSecret = async (partnerId: string) => {
    if (!mongoose.isValidObjectId(partnerId)) {
      throw new BadRequestException("Invalid partner id", HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
    }
    const partner = await Partner.findById(partnerId).select("+webhook.secretCiphertext");
    if (!partner) throw notFound("Partner");
    return partner;
  };

  private publicWebhookView = (webhook: { url?: string; enabled?: boolean; updatedAt?: Date } | undefined) => ({
    url: webhook?.url ?? null,
    enabled: webhook?.enabled === true,
    updatedAt: webhook?.updatedAt ?? null,
  });

  getWebhook = async (partnerId: string) => {
    const partner = await this.getPartnerWithSecret(partnerId);
    return {
      webhook: {
        ...this.publicWebhookView(partner.webhook),
        hasSigningSecret: !!partner.webhook?.secretCiphertext,
      },
    };
  };

  // Creates or updates the webhook. Returns the signing secret ONLY when one
  // is generated (first configuration); it is never retrievable afterwards.
  configureWebhook = async (partnerId: string, body: { url: string; enabled: boolean }) => {
    await this.assertSafeTarget(body.url).catch((error) => {
      throw new BadRequestException(trimError(error), HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR);
    });
    const partner = await this.getPartnerWithSecret(partnerId);

    let signingSecret: string | null = null;
    let secretCiphertext = partner.webhook?.secretCiphertext;
    if (!secretCiphertext) {
      signingSecret = generateSigningSecret("whsec");
      secretCiphertext = sealSecret(signingSecret);
    }

    partner.set("webhook", {
      url: body.url,
      enabled: body.enabled,
      secretCiphertext,
      updatedAt: new Date(),
    });
    await partner.save();

    return {
      webhook: this.publicWebhookView(partner.webhook),
      ...(signingSecret ? { signingSecret } : {}),
    };
  };

  rotateWebhookSecret = async (partnerId: string) => {
    const partner = await this.getPartnerWithSecret(partnerId);
    if (!partner.webhook?.url) {
      throw new BadRequestException(
        "Configure the webhook URL first",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const signingSecret = generateSigningSecret("whsec");
    partner.set("webhook.secretCiphertext", sealSecret(signingSecret));
    partner.set("webhook.updatedAt", new Date());
    await partner.save();
    return { webhook: this.publicWebhookView(partner.webhook), signingSecret };
  };

  // Sends a signed "ping" immediately (not queued) and reports the outcome.
  sendTestPing = async (partnerId: string) => {
    const partner = await this.getPartnerWithSecret(partnerId);
    if (!partner.webhook?.url || !partner.webhook.secretCiphertext) {
      throw new BadRequestException(
        "Configure the webhook first",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const eventId = generatePublicId("evt");
    const result = await this.send(
      partner.webhook.url,
      openSecret(partner.webhook.secretCiphertext),
      eventId,
      {
        id: eventId,
        type: WEBHOOK_EVENT_PING,
        createdAt: new Date().toISOString(),
        data: { message: "Test event from TheOtherWife" },
      },
    );
    return { eventId, delivered: result.ok, responseStatus: result.status ?? null, error: result.error ?? null };
  };

  listDeliveries = async (
    partnerId: string,
    filters: { status?: string; page?: number; limit?: number },
  ) => {
    await this.getPartnerWithSecret(partnerId);
    const { page, limit } = paginate(filters);
    const query: Record<string, unknown> = { partnerId };
    if (filters.status) query.status = filters.status;
    const [deliveries, total] = await Promise.all([
      PartnerWebhookDelivery.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PartnerWebhookDelivery.countDocuments(query),
    ]);
    return { items: deliveries, pagination: paginationResult(page, limit, total) };
  };

  // Re-queues a failed or cancelled delivery for immediate sending.
  retryDelivery = async (partnerId: string, eventId: string) => {
    const delivery = await PartnerWebhookDelivery.findOneAndUpdate(
      { partnerId, eventId, status: { $in: ["failed", "cancelled"] } },
      { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() }, $unset: { lastError: 1 } },
      { new: true },
    ).lean();
    if (!delivery) {
      const exists = await PartnerWebhookDelivery.exists({ partnerId, eventId });
      if (!exists) throw notFound("Delivery");
      throw new AppError(
        "Only failed or cancelled deliveries can be retried",
        HttpStatus.CONFLICT,
        ErrorCode.RESOURCE_CONFLICT,
      );
    }
    return { delivery };
  };
}

export const partnerWebhookService = new PartnerWebhookService();
