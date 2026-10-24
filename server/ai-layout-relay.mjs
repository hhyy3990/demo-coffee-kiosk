import { createHash, randomUUID } from "node:crypto";
import express from "express";
import {
  validateMenuLayoutPlan,
  validateMenuScreenModel,
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
  oneShotConsumed: "개발용 화면 구성 시험은 이미 사용했어요.",
};

function modelForRequest(input) {
  return validateMenuScreenModel(input);
}

function isValidServerToken(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function centralPlanUrl(value, externalToken) {
  if (typeof value !== "string" ||
      value.length > 512 ||
      !isValidServerToken(externalToken)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" ||
        !url.hostname.endsWith(".replit.dev") ||
        url.hostname === "naebangsikqr.replit.app" ||
        (url.port !== "" && url.port !== "443") ||
        url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const endpoint = new URL("/api/ai-layout/plan", url.origin);
    endpoint.searchParams.set("project-protection-bypass", externalToken);
    return endpoint.toString();
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

function safeCentralRequestId(response) {
  const value = response.headers.get("x-request-id");
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

function logRelayEvent(logger, event) {
  const safeEvent = {
    event: "ai-layout-relay",
    requestId: event.requestId,
    stage: event.stage,
    ...(event.centralRequestId ? { centralRequestId: event.centralRequestId } : {}),
    ...(Number.isInteger(event.centralStatus) ? { centralStatus: event.centralStatus } : {}),
    ...(Number.isInteger(event.localStatus) ? { localStatus: event.localStatus } : {}),
    ...(typeof event.timedOut === "boolean" ? { timedOut: event.timedOut } : {}),
    ...(typeof event.planValidated === "boolean" ? { planValidated: event.planValidated } : {}),
  };
  try {
    logger(JSON.stringify(safeEvent));
  } catch {
    // Logging must never change the relay result.
  }
}

class RelayStageError extends Error {
  constructor(stage, { centralRequestId = null, centralStatus = null } = {}) {
    super(stage);
    this.stage = stage;
    this.centralRequestId = centralRequestId;
    this.centralStatus = centralStatus;
  }
}

export function registerAiLayoutRoute(
  app,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    logger = (line) => console.info(line),
  } = {},
) {
  const resultCache = new Map();
  const inFlight = new Map();
  let oneShotRequestConsumed = false;

  app.post(
    "/api/ai-layout/plan",
    parseJsonBody(`${MAX_REQUEST_BYTES}b`),
    async (req, res) => {
      const requestId = randomUUID();
      res.setHeader("X-Request-ID", requestId);
      const log = (stage, details = {}) =>
        logRelayEvent(logger, { requestId, stage, ...details });
      const model = modelForRequest(req.body);
      if (!model) {
        log("model_rejected", { localStatus: 400, planValidated: false });
        return publicError(res, 400, ERRORS.invalidRequest);
      }

      const externalToken = env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN;
      const centralUrl = centralPlanUrl(env.AI_LAYOUT_CENTRAL_URL, externalToken);
      const serviceToken = env.AI_LAYOUT_SERVICE_TOKEN;
      if (env.NODE_ENV !== "development" ||
          env.AI_LAYOUT_RELAY_ENABLED !== "true" ||
          !centralUrl ||
          !isValidServerToken(serviceToken) ||
          typeof fetchImpl !== "function") {
        log("relay_disabled", { localStatus: 503, planValidated: false });
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
        log("cache_hit", {
          centralRequestId: cached.centralRequestId,
          centralStatus: 200,
          localStatus: 200,
          planValidated: true,
        });
        return res.status(200).json(cached.plan);
      }

      let requestPromise = inFlight.get(cacheKey);
      if (!requestPromise) {
        if (env.AI_LAYOUT_RELAY_ONE_SHOT === "true" && oneShotRequestConsumed) {
          log("one_shot_blocked", { localStatus: 429, planValidated: false });
          return publicError(res, 429, ERRORS.oneShotConsumed);
        }
        if (env.AI_LAYOUT_RELAY_ONE_SHOT === "true") oneShotRequestConsumed = true;
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
          const centralRequestId = safeCentralRequestId(response);
          if (response.status !== 200) {
            throw new RelayStageError("central_http_error", {
              centralRequestId,
              centralStatus: response.status,
            });
          }
          let plan;
          try {
            plan = await readBoundedBody(response, MAX_RESPONSE_BYTES);
          } catch (error) {
            throw new RelayStageError(
              error instanceof SyntaxError ? "central_json_parse_error" : "central_response_read_error",
              { centralRequestId, centralStatus: response.status },
            );
          }
          let planValidated = false;
          try {
            planValidated = validateMenuLayoutPlan(plan, model);
          } catch {
            planValidated = false;
          }
          if (!planValidated) {
            throw new RelayStageError("central_plan_validation_error", {
              centralRequestId,
              centralStatus: response.status,
            });
          }
          return { plan, centralRequestId };
        })();
        inFlight.set(cacheKey, requestPromise);
      }

      try {
        const { plan, centralRequestId } = await requestPromise;
        resultCache.delete(cacheKey);
        resultCache.set(cacheKey, { plan, centralRequestId, expiresAt: now() + CACHE_TTL_MS });
        if (resultCache.size > MAX_CACHE_ENTRIES) {
          resultCache.delete(resultCache.keys().next().value);
        }
        log("plan_validated", {
          centralRequestId,
          centralStatus: 200,
          localStatus: 200,
          planValidated: true,
        });
        return res.status(200).json(plan);
      } catch (error) {
        const timedOut = error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        const stage = error instanceof RelayStageError
          ? error.stage
          : timedOut ? "central_timeout" : "central_connection_error";
        log(stage, {
          centralRequestId: error instanceof RelayStageError ? error.centralRequestId : null,
          centralStatus: error instanceof RelayStageError ? error.centralStatus : null,
          localStatus: timedOut ? 504 : 502,
          timedOut,
          planValidated: false,
        });
        return publicError(res, timedOut ? 504 : 502, timedOut ? ERRORS.timeout : ERRORS.upstream);
      } finally {
        if (inFlight.get(cacheKey) === requestPromise) inFlight.delete(cacheKey);
      }
    },
  );
}
