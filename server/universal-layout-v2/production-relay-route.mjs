import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import {
  createUniversalLayoutV2Model,
  universalSha256,
  validateUniversalLayoutV2Plan,
} from "./universal-v2-contract-export.ts";
import {
  demoCoffeeUniversalV2ProductionPolicyForViewport,
} from "./demo-coffee-production-policy.ts";

const ENDPOINT = "https://naebangsikqr.replit.app/api/production/universal-layout/v2/openai-plan";
const MAX_BODY = "8kb";
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 60_000;
const MAX_PROVIDER_REQUESTS = 30;
const ITEM_IDS = ["americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea"];
const G_ACCESSIBILITY = {
  textScale: "large",
  buttonScale: "large",
  contrast: "high",
  viewportMode: { mode: "bottom", heightPercent: 70 },
};

const Input = z.object({
  eventId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  viewportClass: z.enum(["compact", "regular"]),
  accessibility: z.object({
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
  }).strict(),
  orderedItemIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).length(5),
}).strict();

function normalizedContentType(response) {
  const raw = response.headers.get("content-type");
  if (!raw) return null;
  const type = raw.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : null;
}

async function readJsonBounded(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error("RESPONSE_TOO_LARGE");
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

function safeErrorName(error) {
  return ["AbortError", "Error", "SyntaxError", "TimeoutError", "TypeError"].includes(error?.name)
    ? error.name
    : "Error";
}

function errorClass(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.name === "AbortError") return "aborted";
  if (error?.name === "TypeError") return "fetch_type_error";
  return error?.centralStatus ? "central_http_error" : "invalid_upstream_response";
}

export function registerUniversalLayoutV2ProductionRelayRoute(app, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = (line) => console.info(line),
} = {}) {
  if (env.NODE_ENV !== "production") return;
  const inFlight = new Map();
  const cache = new Map();
  let providerRequestCount = 0;

  app.post(
    "/api/production/universal-layout/v2/openai-plan",
    express.json({ limit: MAX_BODY, strict: true, type: "application/json" }),
    async (req, res) => {
      const requestId = randomUUID();
      const startedAt = performance.now();
      const elapsedMs = () => Math.max(0, Math.round(performance.now() - startedAt));
      const log = (stage, details = {}) => {
        try {
          logger(JSON.stringify({ event: "universal-layout-v2-production-relay", requestId, stage, ...details }));
        } catch { /* Logging must not affect the request result. */ }
      };
      res.setHeader("X-Request-ID", requestId);
      res.setHeader("Cache-Control", "no-store");

      if (env.UNIVERSAL_LAYOUT_V2_PRODUCTION_AI_ENABLED !== "true") {
        log("relay_disabled", { localStatus: 503 });
        return res.status(503).json({ error: "RELAY_DISABLED" });
      }
      const hostToken = env.UNIVERSAL_LAYOUT_V2_PRODUCTION_HOST_TOKEN?.trim() ?? "";
      const externalAccessToken =
        env.UNIVERSAL_LAYOUT_V2_PRODUCTION_EXTERNAL_ACCESS_TOKEN?.trim() ?? "";
      if (!hostToken || !externalAccessToken || typeof fetchImpl !== "function") {
        log("relay_unconfigured", { localStatus: 503 });
        return res.status(503).json({ error: "RELAY_NOT_CONFIGURED" });
      }

      const parsed = Input.safeParse(req.body);
      if (!parsed.success ||
          parsed.data?.accessibility.textScale !== G_ACCESSIBILITY.textScale ||
          parsed.data?.accessibility.buttonScale !== G_ACCESSIBILITY.buttonScale ||
          parsed.data?.accessibility.contrast !== G_ACCESSIBILITY.contrast ||
          parsed.data?.accessibility.viewportMode?.mode !== G_ACCESSIBILITY.viewportMode.mode ||
          parsed.data?.accessibility.viewportMode?.heightPercent !== G_ACCESSIBILITY.viewportMode.heightPercent ||
          JSON.stringify(parsed.data?.orderedItemIds) !== JSON.stringify(ITEM_IDS)) {
        log("request_rejected", { localStatus: 400 });
        return res.status(400).json({ error: "INVALID_MODEL_INPUT" });
      }

      const policy = demoCoffeeUniversalV2ProductionPolicyForViewport(parsed.data.viewportClass);
      if (!policy) {
        log("model_rejected", { localStatus: 400 });
        return res.status(400).json({ error: "MODEL_INVALID" });
      }
      let model;
      try {
        model = createUniversalLayoutV2Model(policy, {
          viewportClass: parsed.data.viewportClass,
          accessibility: parsed.data.accessibility,
          layoutCapabilities: [],
          componentState: [{
            id: "menu.product-list",
            itemCount: parsed.data.orderedItemIds.length,
            itemOrderHash: universalSha256({ orderedItemIds: parsed.data.orderedItemIds }),
          }],
        });
      } catch {
        log("model_rejected", { localStatus: 400 });
        return res.status(400).json({ error: "MODEL_INVALID" });
      }

      const modelHash = universalSha256({ model });
      const eventKey = parsed.data.eventId;
      const idempotencyKey = eventKey;
      const nowValue = now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= nowValue) cache.delete(key);
      }
      const cached = cache.get(eventKey);
      if (cached) {
        if (cached.modelHash !== modelHash) {
          log("event_model_conflict", { localStatus: 409 });
          return res.status(409).json({ error: "EVENT_MODEL_CONFLICT" });
        }
        log("duplicate_cached", { localStatus: 200 });
        return res.status(200).json({ model, plan: cached.plan });
      }

      let pending = inFlight.get(eventKey);
      if (pending && pending.modelHash !== modelHash) {
        log("event_model_conflict", { localStatus: 409 });
        return res.status(409).json({ error: "EVENT_MODEL_CONFLICT" });
      }
      if (!pending) {
        if (providerRequestCount >= MAX_PROVIDER_REQUESTS) {
          log("request_limit_reached", { localStatus: 429, providerRequestCount });
          return res.status(429).json({ error: "UPSTREAM_REQUEST_LIMIT" });
        }
        providerRequestCount += 1;
        const request = (async () => {
          log("upstream_start", { elapsedMs: elapsedMs() });
          const response = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${externalAccessToken}`,
              "X-Host-AI-Token": hostToken,
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({ model }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
            redirect: "manual",
          });
          const contentType = normalizedContentType(response);
          const centralIdValue = response.headers.get("x-request-id");
          const centralRequestId = typeof centralIdValue === "string" &&
            /^[A-Za-z0-9._:-]{1,128}$/.test(centralIdValue) ? centralIdValue : null;
          const redirectDetected = response.status >= 300 && response.status < 400;
          log("upstream_response", {
            centralStatus: response.status,
            centralContentType: contentType,
            centralRequestId,
            redirectDetected,
            elapsedMs: elapsedMs(),
          });
          if (redirectDetected) {
            const error = new Error("UPSTREAM_REDIRECT_REJECTED");
            error.centralStatus = response.status;
            error.failureClass = "redirect_rejected";
            throw error;
          }
          if (response.status !== 200) {
            const error = new Error("UPSTREAM_HTTP_ERROR");
            error.centralStatus = response.status;
            throw error;
          }
          if (contentType !== "application/json") throw new Error("INVALID_CONTENT_TYPE");
          const plan = await readJsonBounded(response);
          validateUniversalLayoutV2Plan(plan, model, [policy]);
          return { plan, centralRequestId };
        })();
        // Keep the event claimed even when upstream fails: the client must not
        // turn a replay into another provider attempt.
        pending = { modelHash, promise: request };
        inFlight.set(eventKey, pending);
      } else {
        log("duplicate_coalesced", { localStatus: 200 });
      }

      try {
        const { plan, centralRequestId } = await pending.promise;
        cache.set(eventKey, { plan, modelHash, expiresAt: now() + CACHE_TTL_MS });
        log("plan_validated", { centralRequestId });
        log("client_response", { localStatus: 200, centralRequestId, elapsedMs: elapsedMs() });
        return res.status(200).json({ model, plan });
      } catch (error) {
        const centralStatus = Number.isInteger(error?.centralStatus) ? error.centralStatus : null;
        const failureClass = error?.failureClass ?? errorClass(error);
        const errorName = safeErrorName(error);
        log("upstream_exception", {
          centralStatus,
          elapsedMs: elapsedMs(),
          timeout: failureClass === "timeout",
          errorName,
          failureClass,
        });
        log("client_response", {
          localStatus: 502,
          centralStatus,
          elapsedMs: elapsedMs(),
          failureClass,
        });
        return res.status(502).json({ error: "UPSTREAM_FAILURE" });
      }
    },
  );
}
