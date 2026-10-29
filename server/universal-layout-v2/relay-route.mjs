import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import {
  createUniversalLayoutV2Model,
  universalSha256,
  validateUniversalLayoutV2Plan,
  validateUniversalLayoutV2Model,
} from "./universal-v2-contract-export.ts";
import { demoCoffeeUniversalV2DevPolicy } from "./demo-coffee-dev-policy.ts";

const FAKE_ENDPOINT_PATH = "/api/dev/universal-layout/v2/fake-plan";
const OPENAI_ENDPOINT_PATH = "/api/dev/universal-layout/v2/openai-plan";
const MAX_BODY = "8kb";
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 15_000;
const MAX_UPSTREAM_REQUESTS = 1;
const policies = [demoCoffeeUniversalV2DevPolicy];

const Accessibility = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  viewportMode: z.union([
    z.null(),
    z.object({
      mode: z.literal("bottom"),
      heightPercent: z.union([z.literal(60), z.literal(70), z.literal(80)]),
    }).strict(),
  ]),
}).strict();

const Input = z.object({
  viewportClass: z.enum(["compact", "regular", "wide"]),
  accessibility: Accessibility,
  orderedItemIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderedItemIds).size !== value.orderedItemIds.length) {
    context.addIssue({ code: "custom", path: ["orderedItemIds"], message: "DUPLICATE_ITEM_ID" });
  }
});

function validToken(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizedContentType(response) {
  const value = response.headers.get("content-type");
  if (typeof value !== "string") return null;
  const mimeType = value.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : null;
}

function buildCentralUrl(base, externalToken, endpointPath) {
  if (typeof base !== "string" || base.length > 512 || !validToken(externalToken)) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".replit.dev") ||
        url.hostname === "naebangsikqr.replit.app" ||
        (url.port && url.port !== "443") || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const endpoint = new URL(endpointPath, url.origin);
    endpoint.searchParams.set("project-protection-bypass", externalToken);
    return endpoint.toString();
  } catch {
    return null;
  }
}

function parseJsonBody(req, res, next) {
  return express.json({ limit: MAX_BODY, strict: true, type: "application/json" })(
    req,
    res,
    (error) => {
      if (!error) return next();
      return res.status(error.status === 413 ? 413 : 400)
        .json({ error: error.status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_JSON" });
    },
  );
}

function buildModel(input) {
  return validateUniversalLayoutV2Model(
    createUniversalLayoutV2Model(demoCoffeeUniversalV2DevPolicy, {
      viewportClass: input.viewportClass,
      accessibility: input.accessibility,
      layoutCapabilities: [],
      componentState: [{
        id: "menu.product-list",
        itemCount: input.orderedItemIds.length,
        itemOrderHash: universalSha256({ orderedItemIds: input.orderedItemIds }),
      }],
    }),
    policies,
  );
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("EMPTY_RESPONSE");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function registerUniversalLayoutV2RelayRoute(app, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = (line) => console.info(line),
  mode = "fake",
} = {}) {
  if (env.NODE_ENV !== "development") return;
  if (mode !== "fake" && mode !== "openai") throw new Error("INVALID_UNIVERSAL_V2_RELAY_MODE");

  const endpointPath = mode === "openai" ? OPENAI_ENDPOINT_PATH : FAKE_ENDPOINT_PATH;
  const enabledEnv = mode === "openai"
    ? "UNIVERSAL_LAYOUT_V2_OPENAI_RELAY_ENABLED"
    : "UNIVERSAL_LAYOUT_V2_RELAY_ENABLED";
  const conflictingEnvs = mode === "openai"
    ? [
        "UNIVERSAL_LAYOUT_V2_RELAY_ENABLED",
        "UNIVERSAL_LAYOUT_RELAY_ENABLED",
        "UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED",
        "AI_LAYOUT_RELAY_ENABLED",
      ]
    : ["UNIVERSAL_LAYOUT_V2_OPENAI_RELAY_ENABLED"];
  const inFlight = new Map();
  const resultCache = new Map();
  let upstreamAttemptCount = 0;

  app.post(
    mode === "openai"
      ? "/api/dev/universal-layout/v2/openai-plan"
      : "/api/dev/universal-layout/v2/relay-plan",
    parseJsonBody,
    async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    const log = (stage, details = {}) => logger(JSON.stringify({
      event: "universal-layout-v2-relay",
      requestId,
      stage,
      ...details,
    }));

    if (env.NODE_ENV !== "development" ||
        env[enabledEnv] !== "true" ||
        conflictingEnvs.some((name) => env[name] === "true") ||
        typeof fetchImpl !== "function") {
      log("relay_disabled", { localStatus: 503 });
      return res.status(503).json({ error: "RELAY_DISABLED" });
    }

    const parsed = Input.safeParse(req.body);
    if (!parsed.success) {
      log("request_rejected", { localStatus: 400 });
      return res.status(400).json({ error: "INVALID_MODEL_INPUT" });
    }

    const externalToken = env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN;
    const serviceToken = env.AI_LAYOUT_SERVICE_TOKEN;
    const url = buildCentralUrl(env.AI_LAYOUT_CENTRAL_URL, externalToken, endpointPath);
    if (!url || !validToken(serviceToken)) {
      log("relay_unconfigured", { localStatus: 503 });
      return res.status(503).json({ error: "RELAY_NOT_CONFIGURED" });
    }

    let model;
    try {
      model = buildModel(parsed.data);
    } catch {
      log("model_rejected", { localStatus: 400 });
      return res.status(400).json({ error: "MODEL_INVALID" });
    }

    const key = universalSha256(model);
    const timestamp = now();
    for (const [cacheKey, entry] of resultCache) {
      if (entry.expiresAt <= timestamp) resultCache.delete(cacheKey);
    }
    const cached = resultCache.get(key);
    if (cached) {
      log("duplicate_cached", { localStatus: 200 });
      return res.status(200).json({ model, plan: cached.plan });
    }

    let pending = inFlight.get(key);
    if (!pending) {
      if (upstreamAttemptCount >= MAX_UPSTREAM_REQUESTS) {
        log("upstream_request_limit_reached", {
          localStatus: 429,
          upstreamAttemptCount,
          maxUpstreamRequests: MAX_UPSTREAM_REQUESTS,
        });
        return res.status(429).json({ error: "UPSTREAM_REQUEST_LIMIT" });
      }
      pending = (async () => {
        upstreamAttemptCount += 1;
        log("central_upstream_started", {
          upstreamAttemptCount,
          maxUpstreamRequests: MAX_UPSTREAM_REQUESTS,
        });
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceToken}`,
          },
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
          redirect: "error",
        });
        const centralContentType = normalizedContentType(response);
        const centralId = response.headers.get("x-request-id");
        const centralRequestId = typeof centralId === "string" &&
          /^[A-Za-z0-9._:-]{1,128}$/.test(centralId) ? centralId : null;
        if (response.status !== 200) {
          const error = new Error("UPSTREAM_HTTP_ERROR");
          error.centralStatus = response.status;
          error.centralContentType = centralContentType;
          error.centralRequestId = centralRequestId;
          throw error;
        }
        let plan;
        try {
          plan = await readBoundedJson(response);
          validateUniversalLayoutV2Plan(plan, model, policies);
        } catch {
          const error = new Error("UPSTREAM_PLAN_INVALID");
          error.centralStatus = response.status;
          error.centralContentType = centralContentType;
          error.centralRequestId = centralRequestId;
          error.publicCode = "UPSTREAM_PLAN_INVALID";
          throw error;
        }
        return { plan, centralRequestId, centralContentType };
      })();
      inFlight.set(key, pending);
    } else {
      log("duplicate_coalesced", { localStatus: 200 });
    }

    try {
      const { plan, centralRequestId, centralContentType } = await pending;
      resultCache.set(key, { plan, expiresAt: now() + CACHE_TTL_MS });
      if (resultCache.size > 64) resultCache.delete(resultCache.keys().next().value);
      log("plan_validated", {
        localStatus: 200,
        centralStatus: 200,
        centralContentType,
        centralRequestId,
      });
      return res.status(200).json({ model, plan });
    } catch (error) {
      const centralStatus = Number.isInteger(error?.centralStatus) ? error.centralStatus : null;
      const centralRequestId = typeof error?.centralRequestId === "string" ? error.centralRequestId : null;
      const centralContentType = typeof error?.centralContentType === "string"
        ? error.centralContentType
        : null;
      const failureClass = error?.publicCode === "UPSTREAM_PLAN_INVALID"
        ? "plan_invalid"
        : centralStatus ? "central_http_error"
          : error?.name === "TimeoutError" ? "timeout" : "network_or_response_error";
      log("upstream_rejected", {
        localStatus: 502,
        centralStatus,
        centralContentType,
        centralRequestId,
        failureClass,
      });
      return res.status(502).json({
        error: typeof error?.publicCode === "string"
          ? error.publicCode
          : centralStatus ? "UPSTREAM_HTTP_ERROR" : "UPSTREAM_FAILURE",
      });
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
    },
  );
}
