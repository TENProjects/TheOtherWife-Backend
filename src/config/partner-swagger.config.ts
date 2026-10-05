/** @format */

import { swaggerSpec } from "./swagger.config.js";

// Partner-facing OpenAPI document, derived from the full TOW spec so the two
// can never drift apart. Contains ONLY the /api/v1/partner/* operations and
// the components they actually reference — no internal, user or admin
// endpoints, schemas or security schemes. Served at /attribution/docs.json
// and rendered at /attribution/docs; the full spec stays at /tow.

const PARTNER_PATH_PREFIX = "/api/v1/partner/";
const COMPONENT_REF = /^#\/components\/([^/]+)\/(.+)$/;

type Json = Record<string, any>;

const collectRefs = (node: unknown, refs: Set<string>) => {
  if (Array.isArray(node)) {
    node.forEach((item) => collectRefs(item, refs));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.add(value);
      else collectRefs(value, refs);
    }
  }
};

const EXTRA_COMPONENT_REFS = ["#/components/schemas/PartnerWebhookEvent"];

const SIGNATURE_PARAMETERS: Json = {
  PartnerSignatureTimestamp: {
    in: "header",
    name: "TOW-Timestamp",
    required: false,
    description:
      "Unix time in seconds when the request was signed. Required when your key requires signed requests. Must be within 300 seconds of TOW server time.",
    schema: { type: "string", pattern: "^[0-9]{1,12}$", example: "1760000000" },
  },
  PartnerSignature: {
    in: "header",
    name: "TOW-Signature",
    required: false,
    description:
      "v1=<lowercase hex HMAC-SHA256 of the signing string, keyed with your signing secret>. Required when your key requires signed requests; verified whenever sent.",
    schema: { type: "string", pattern: "^v1=[a-f0-9]{64}$" },
  },
};

// Rendered as Markdown at the top of /attribution/docs.
const PARTNER_API_DESCRIPTION = [
  "API for approved TheOtherWife (TOW) partners to register HomeChef and customer leads and track their onboarding status.",
  "",
  "## Authentication",
  "Send your API key on every request: `Authorization: Bearer tow_pk_<keyId>.<secret>`. Every POST also needs an `Idempotency-Key` header (a new UUID per logical request, reused on retries). Keys can be locked to your server IP addresses.",
  "",
  "## Request signing (HMAC)",
  "If your key requires signed requests, add two headers to every request:",
  "",
  "- `TOW-Timestamp`: current Unix time in seconds.",
  "- `TOW-Signature`: `v1=` followed by the lowercase hex HMAC-SHA256 of the signing string, keyed with your signing secret (`tow_sk_...`).",
  "",
  "The signing string is these four values joined with a single newline character (LF, `\\n`), with no trailing newline, in this order:",
  "",
  "1. the same timestamp as `TOW-Timestamp`",
  "2. the HTTP method in upper case, e.g. `POST`",
  "3. the request path and query string exactly as sent, e.g. `/api/v1/partner/homechefs?limit=50`",
  "4. the lowercase hex SHA-256 of the exact request body bytes (SHA-256 of an empty string when there is no body)",
  "",
  "Requests more than 300 seconds from TOW server time are rejected. A failed check returns 401 `PARTNER_SIGNATURE_INVALID` with the reason.",
  "",
  "## Webhooks",
  "TOW can POST a `submission.status_changed` event (schema `PartnerWebhookEvent` below) to your HTTPS endpoint whenever one of your submissions changes status. Changes are detected within about 5 minutes.",
  "",
  "Each delivery carries three headers:",
  "",
  "- `TOW-Webhook-Id`: the event id (same as `id` in the body).",
  "- `TOW-Webhook-Timestamp`: Unix time in seconds.",
  "- `TOW-Signature`: `v1=` followed by the lowercase hex HMAC-SHA256 of `<TOW-Webhook-Timestamp>.<raw request body>`, keyed with your webhook secret (`whsec_...`).",
  "",
  "Verify the signature against the raw body before parsing it, and reject timestamps more than 300 seconds old. Reply with any 2xx status within 10 seconds. Failed deliveries are retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours. Use `id` to ignore duplicates and `data.sequence` to ignore out-of-order events.",
].join("\n");

export const buildPartnerSpec = (fullSpec: Json): Json => {
  const spec: Json = JSON.parse(JSON.stringify(fullSpec));

  const paths: Json = {};
  for (const [path, item] of Object.entries<Json>(spec.paths ?? {})) {
    if (path.startsWith(PARTNER_PATH_PREFIX)) paths[path] = item;
  }

  // Optional request-signing headers apply to every partner operation.
  for (const item of Object.values<Json>(paths)) {
    for (const op of Object.values<Json>(item)) {
      op.parameters = [
        ...(op.parameters ?? []),
        { $ref: "#/components/parameters/PartnerSignatureTimestamp" },
        { $ref: "#/components/parameters/PartnerSignature" },
      ];
    }
  }

  // Keep only components reachable from the partner paths (transitively),
  // plus the webhook event schema (documented, but not used by any path).
  const components: Json = spec.components ?? {};
  const kept: Json = { parameters: { ...SIGNATURE_PARAMETERS } };
  const seen = new Set<string>();
  const queue = new Set<string>(EXTRA_COMPONENT_REFS);
  collectRefs(paths, queue);

  while (queue.size) {
    const [ref] = queue;
    queue.delete(ref);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const match = ref.match(COMPONENT_REF);
    if (!match) continue;
    const [, section, name] = match;
    const value = components[section]?.[name];
    if (value === undefined) continue;
    kept[section] ??= {};
    kept[section][name] = value;
    const nested = new Set<string>();
    collectRefs(value, nested);
    nested.forEach((r) => !seen.has(r) && queue.add(r));
  }

  // Security schemes are referenced by name (not $ref) from `security`.
  const schemeNames = new Set<string>();
  for (const item of Object.values<Json>(paths)) {
    for (const op of Object.values<Json>(item)) {
      for (const requirement of op?.security ?? []) {
        Object.keys(requirement).forEach((name) => schemeNames.add(name));
      }
    }
  }
  for (const name of schemeNames) {
    const scheme = components.securitySchemes?.[name];
    if (scheme) {
      kept.securitySchemes ??= {};
      kept.securitySchemes[name] = scheme;
    }
  }

  return {
    openapi: spec.openapi,
    info: {
      title: "TOW Partner API",
      version: "1.0.0",
      description: PARTNER_API_DESCRIPTION,
    },
    servers: spec.servers,
    tags: [
      {
        name: "Partner API",
        description: "Endpoints available to approved partner integrations.",
      },
    ],
    paths,
    components: kept,
  };
};

export const partnerSwaggerSpec = buildPartnerSpec(swaggerSpec as Json);
