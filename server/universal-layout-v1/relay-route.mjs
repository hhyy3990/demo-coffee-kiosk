import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import {
  createUniversalLayoutModel,
  universalSha256,
  validateUniversalLayoutModel,
  validateUniversalLayoutPlan,
} from "./universal-layout-contract.ts";
import { demoCoffeeMenuPolicy } from "./demo-coffee-policy.ts";

const MAX_BODY = "8kb";
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const Accessibility = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  viewportMode: z.union([
    z.null(),
    z.object({ mode: z.literal("bottom"), heightPercent: z.union([
      z.literal(60), z.literal(70), z.literal(80),
    ]) }).strict(),
  ]),
}).strict();
const Input = z.object({
  viewportClass: z.enum(["compact", "regular"]),
  accessibility: Accessibility,
  orderedItemIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderedItemIds).size !== value.orderedItemIds.length) {
    context.addIssue({ code: "custom", path: ["orderedItemIds"], message: "DUPLICATE_ITEM_ID" });
  }
});
const policies = [demoCoffeeMenuPolicy];

function validToken(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function buildPlanUrl(base, externalToken) {
  if (typeof base !== "string" || base.length > 512 || !validToken(externalToken)) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".replit.dev") ||
        url.hostname === "naebangsikqr.replit.app" ||
        (url.port && url.port !== "443") || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const endpoint = new URL("/api/dev/universal-layout/plan", url.origin);
    endpoint.searchParams.set("project-protection-bypass", externalToken);
    return endpoint.toString();
  } catch {
    return null;
  }
}

function parseJsonBody(req, res, next) {
  return express.json({ limit: MAX_BODY, strict: true, type: "application/json" })(
    req, res, (error) => {
      if (!error) return next();
      return res.status(error.status === 413 ? 413 : 400)
        .json({ error: error.status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_JSON" });
    },
  );
}

async function readPlan(response) {
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
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function buildModel(input) {
  return validateUniversalLayoutModel(createUniversalLayoutModel(demoCoffeeMenuPolicy, {
    viewportClass: input.viewportClass,
    accessibility: input.accessibility,
    componentState: [{
      id: "menu.product-list",
      itemCount: input.orderedItemIds.length,
      itemOrderHash: universalSha256({ orderedItemIds: input.orderedItemIds }),
    }],
  }), policies);
}

export function registerUniversalLayoutRelayRoute(app, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = (line) => console.info(line),
} = {}) {
  if (env.NODE_ENV !== "development") return;
  const inFlight = new Map();
  app.post("/api/dev/universal-layout/plan", parseJsonBody, async (req, res) => {
    const localRequestId = randomUUID();
    res.setHeader("X-Request-ID", localRequestId);
    res.setHeader("Cache-Control", "no-store");
    const log = (stage, details = {}) => {
      logger(JSON.stringify({ event: "universal-layout-relay", localRequestId, stage, ...details }));
    };
    if (env.NODE_ENV !== "development" || env.UNIVERSAL_LAYOUT_RELAY_ENABLED !== "true") {
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
    const url = buildPlanUrl(env.AI_LAYOUT_CENTRAL_URL, externalToken);
    if (!url || !validToken(serviceToken) || typeof fetchImpl !== "function") {
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
    const requestKey = `${model.structureHash}:${model.constraintHash}`;
    let pending = inFlight.get(requestKey);
    if (!pending) {
      pending = (async () => {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceToken}`,
          },
          body: JSON.stringify(model),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
          redirect: "error",
        });
        const centralId = response.headers.get("x-request-id");
        const centralRequestId = typeof centralId === "string" &&
          /^[A-Za-z0-9._:-]{1,128}$/.test(centralId) ? centralId : null;
        if (response.status !== 200) {
          const error = new Error("UPSTREAM_HTTP_ERROR");
          error.centralStatus = response.status;
          error.centralRequestId = centralRequestId;
          throw error;
        }
        let plan;
        try {
          plan = await readPlan(response);
          validateUniversalLayoutPlan(plan, model, policies);
        } catch {
          const error = new Error("UPSTREAM_PLAN_INVALID");
          error.centralStatus = response.status;
          error.centralRequestId = centralRequestId;
          error.publicCode = "UPSTREAM_PLAN_INVALID";
          throw error;
        }
        return { plan, centralRequestId };
      })();
      inFlight.set(requestKey, pending);
    } else {
      log("duplicate_coalesced", { localStatus: 200 });
    }
    try {
      const { plan, centralRequestId } = await pending;
      log("plan_validated", { localStatus: 200, centralStatus: 200, centralRequestId });
      return res.status(200).json({ model, plan });
    } catch (error) {
      const centralStatus = Number.isInteger(error?.centralStatus) ? error.centralStatus : null;
      const centralRequestId = typeof error?.centralRequestId === "string" ? error.centralRequestId : null;
      log("upstream_rejected", { localStatus: 502, centralStatus, centralRequestId });
      return res.status(502).json({
        error: typeof error?.publicCode === "string"
          ? error.publicCode
          : centralStatus ? "UPSTREAM_HTTP_ERROR" : "UPSTREAM_FAILURE",
      });
    } finally {
      if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey);
    }
  });
}
