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

export const buildPartnerSpec = (fullSpec: Json): Json => {
  const spec: Json = JSON.parse(JSON.stringify(fullSpec));

  const paths: Json = {};
  for (const [path, item] of Object.entries<Json>(spec.paths ?? {})) {
    if (path.startsWith(PARTNER_PATH_PREFIX)) paths[path] = item;
  }

  // Keep only components reachable from the partner paths (transitively).
  const components: Json = spec.components ?? {};
  const kept: Json = {};
  const seen = new Set<string>();
  const queue = new Set<string>();
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
      description:
        "API for approved TheOtherWife (TOW) partners to register HomeChef and customer leads and track their onboarding status. Every request needs your partner API key (`Authorization: Bearer tow_pk_<keyId>.<secret>`); every POST also needs an `Idempotency-Key` header.",
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
