import { createHash } from "node:crypto";
import express from "express";
import {
  createMenuScreenModel,
  validateMenuLayoutPlan,
} from "../src/accessibility/menuLayoutPlan.ts";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 128;

const ERRORS = {
  invalidRequest: "화면 구성 요청을 확인할 수 없어요.",
  disabled: "화면 구성 계획 API가 아직 설정되지 않았어요.",
  upstream: "화면 구성 서비스를 사용할 수 없어요.",
  timeout: "화면 구성 서비스 응답이 늦어요.",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameContractValue(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameContractValue(value, expected[index]));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) =>
        key === expectedKeys[index] && sameContractValue(actual[key], expected[key]),
      );
  }
  return actual === expected;
}

function modelForRequest(input) {
  if (!isRecord(input) ||
      (input.viewportClass !== "compact" && input.viewportClass !== "regular") ||
      !isRecord(input.constraints)) return null;

  const constraints = input.constraints;
  if (!["standard", "large", "extraLarge"].includes(constraints.textScale) ||
      !["standard", "large"].includes(constraints.buttonScale) ||
      typeof constraints.highContrast !== "boolean") return null;
  const viewportModePercent = constraints.viewportModePercent;
  if (viewportModePercent !== null &&
      viewportModePercent !== 60 && viewportModePercent !== 70 && viewportModePercent !== 80) {
    return null;
  }

  const width = input.viewportClass === "compact" ? 360 : 390;
  const profile = {
    textSize: constraints.textScale,
    buttonSize: constraints.buttonScale,
    contrast: constraints.highContrast === true ? "high" : "standard",
    viewportMode: viewportModePercent === null ? null : { heightPercent: viewportModePercent },
  };

  let expected;
  try {
    expected = createMenuScreenModel(width, profile);
  } catch {
    return null;
  }

  // The model has no pixel width. Use the canonical 360/390 representatives and
  // fail closed for other regular-width profiles rather than infer their layout.
  if (!sameContractValue(input, expected)) return null;
  return expected;
}

function centralPlanUrl(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" ||
        !url.hostname.endsWith(".replit.dev") ||
        url.hostname === "naebangsikqr.replit.app" ||
        url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return `${url.origin}/api/ai-layout/plan`;
  } catch {
    return null;
  }
}

function parseJsonBody(limit) {
  const parser = express.json({ limit, strict: true, type: "application/json" });
  return (req, res, next) => parser(req, res, (error) => {
    if (!error) return next();
    const status = error.status === 413 ? 413 : 400;
    return res.status(status).json({
      error: status === 413 ? "요청 본문이 너무 커요." : ERRORS.invalidRequest,
    });
  });
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("response-too-large");
  }
  if (!response.body) throw new Error("empty-response");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response-too-large");
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

function publicError(res, status, error) {
  return res.status(status).json({ error });
}

export function registerAiLayoutRoute(
  app,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  } = {},
) {
  const resultCache = new Map();
  const inFlight = new Map();

  app.post(
    "/api/ai-layout/plan",
    parseJsonBody(`${MAX_REQUEST_BYTES}b`),
    async (req, res) => {
      const model = modelForRequest(req.body);
      if (!model) return publicError(res, 400, ERRORS.invalidRequest);

      const centralUrl = centralPlanUrl(env.AI_LAYOUT_CENTRAL_URL);
      const serviceToken = env.AI_LAYOUT_SERVICE_TOKEN;
      if (env.NODE_ENV === "production" ||
          env.AI_LAYOUT_RELAY_ENABLED !== "true" ||
          !centralUrl ||
          typeof serviceToken !== "string" ||
          serviceToken.length < 1 ||
          serviceToken.length > 2048 ||
          /[\r\n]/.test(serviceToken) ||
          typeof fetchImpl !== "function") {
        return publicError(res, 503, ERRORS.disabled);
      }

      const requestBody = JSON.stringify(model);
      const cacheKey = createHash("sha256").update(requestBody).digest("hex");
      const timestamp = now();
      for (const [key, entry] of resultCache) {
        if (entry.expiresAt <= timestamp) resultCache.delete(key);
      }
      const cached = resultCache.get(cacheKey);
      if (cached && cached.expiresAt > timestamp) {
        return res.status(200).json(cached.plan);
      }

      let requestPromise = inFlight.get(cacheKey);
      if (!requestPromise) {
        requestPromise = (async () => {
          const response = await fetchImpl(centralUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceToken}`,
            },
            body: requestBody,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
            redirect: "error",
          });
          if (response.status !== 200) throw new Error("upstream-status");
          const plan = await readBoundedBody(response, MAX_RESPONSE_BYTES);
          if (!validateMenuLayoutPlan(plan, model)) throw new Error("invalid-upstream-plan");
          return plan;
        })();
        inFlight.set(cacheKey, requestPromise);
      }

      try {
        const plan = await requestPromise;
        resultCache.delete(cacheKey);
        resultCache.set(cacheKey, { plan, expiresAt: now() + CACHE_TTL_MS });
        if (resultCache.size > MAX_CACHE_ENTRIES) {
          resultCache.delete(resultCache.keys().next().value);
        }
        return res.status(200).json(plan);
      } catch (error) {
        const timedOut = error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        return publicError(res, timedOut ? 504 : 502, timedOut ? ERRORS.timeout : ERRORS.upstream);
      } finally {
        if (inFlight.get(cacheKey) === requestPromise) inFlight.delete(cacheKey);
      }
    },
  );
}
