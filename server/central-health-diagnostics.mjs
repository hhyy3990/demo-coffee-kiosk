const SAFE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const MAX_HEALTH_RESPONSE_BYTES = 4 * 1024;

const DNS_CODES = new Set(["EAI_AGAIN", "ENOTFOUND"]);
const CONNECTION_CODES = new Set([
  "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ECONNRESET", "EPIPE",
]);
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function isValidToken(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function buildHealthUrl(value, externalToken) {
  if (typeof value !== "string" || value.length > 512 || !isValidToken(externalToken)) {
    return null;
  }
  try {
    const base = new URL(value);
    if (base.protocol !== "https:" ||
        !base.hostname.endsWith(".replit.dev") ||
        base.hostname === "naebangsikqr.replit.app" ||
        (base.port !== "" && base.port !== "443") ||
        base.username || base.password ||
        base.pathname !== "/" || base.search || base.hash) return null;
    const endpoint = new URL("/api/health", base.origin);
    endpoint.searchParams.set("project-protection-bypass", externalToken);
    return endpoint;
  } catch {
    return null;
  }
}

function normalizeContentType(response) {
  const mediaType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(mediaType)
    ? mediaType
    : "unknown";
}

function safeRequestId(response) {
  const value = response.headers.get("x-request-id");
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

function isJsonContentType(contentType) {
  return contentType === "application/json" || contentType.endsWith("+json");
}

function safeExceptionName(error) {
  return ["TypeError", "TimeoutError", "AbortError", "Error"].includes(error?.name)
    ? error.name
    : "OtherError";
}

function findSafeNetworkCode(error) {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1, current = current.cause) {
    const code = current.code;
    if (typeof code === "string" && SAFE_NETWORK_CODES.has(code)) return code;
  }
  return null;
}

function classifyFetchFailure(error) {
  const errorCode = findSafeNetworkCode(error);
  const timedOut = error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    (errorCode !== null && TIMEOUT_CODES.has(errorCode));
  const errorType = timedOut
    ? "timeout"
    : errorCode && DNS_CODES.has(errorCode)
      ? "dns_failure"
      : errorCode && TLS_CODES.has(errorCode)
        ? "tls_failure"
        : errorCode && CONNECTION_CODES.has(errorCode)
          ? "connection_failure"
          : "network_error";
  return {
    stage: "fetch",
    errorType,
    exceptionName: safeExceptionName(error),
    ...(errorCode ? { errorCode } : {}),
    timedOut,
    responseReceived: false,
    redirectDetected: false,
    httpStatus: null,
    contentType: null,
    statusOk: false,
  };
}

function classifyResponse(response, contentType, statusOk) {
  const redirectDetected = response.status >= 300 && response.status < 400;
  let errorType = "http_error";
  if (redirectDetected) {
    errorType = "redirect_response";
  } else if ((response.status === 401 || response.status === 403) &&
      contentType === "text/html") {
    errorType = "html_protection_or_auth_page";
  } else if (response.status === 401 || response.status === 403) {
    errorType = "auth_failure";
  } else if (response.status === 404 && contentType === "text/html") {
    errorType = "html_404_or_protection_page";
  } else if (response.status === 404 && isJsonContentType(contentType)) {
    errorType = "json_404";
  } else if (response.status === 404) {
    errorType = "non_json_404";
  } else if (response.status === 200 && !isJsonContentType(contentType)) {
    errorType = "unexpected_content_type";
  } else if (response.status === 200 && !statusOk) {
    errorType = "health_status_not_ok";
  } else if (response.status === 200) {
    errorType = "health_ok";
  }
  return {
    stage: "response",
    errorType,
    exceptionName: null,
    timedOut: false,
    responseReceived: true,
    redirectDetected,
    httpStatus: response.status,
    contentType,
    centralRequestId: safeRequestId(response),
    statusOk,
    hasRedirectLocation: redirectDetected && Boolean(response.headers.get("location")),
  };
}

async function readHealthJson(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HEALTH_RESPONSE_BYTES) {
    throw new Error("health-response-too-large");
  }
  if (!response.body) throw new Error("health-response-empty");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HEALTH_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("health-response-too-large");
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

/**
 * Makes one Development-only GET to the central health endpoint.
 * Returns metadata only; never returns the URL, credentials, response body, or redirect target.
 */
export async function checkCentralHealth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  if (env.NODE_ENV !== "development") {
    return {
      stage: "configuration",
      errorType: "development_only",
      timedOut: false,
      responseReceived: false,
      redirectDetected: false,
      httpStatus: null,
      contentType: null,
      statusOk: false,
    };
  }
  if (!buildHealthUrl(env.AI_LAYOUT_CENTRAL_URL, env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN)) {
    return {
      stage: "configuration",
      errorType: "invalid_central_configuration",
      timedOut: false,
      responseReceived: false,
      redirectDetected: false,
      httpStatus: null,
      contentType: null,
      statusOk: false,
    };
  }
  if (!isValidToken(env.AI_LAYOUT_SERVICE_TOKEN)) {
    return {
      stage: "configuration",
      errorType: "missing_service_token",
      timedOut: false,
      responseReceived: false,
      redirectDetected: false,
      httpStatus: null,
      contentType: null,
      statusOk: false,
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      stage: "configuration",
      errorType: "fetch_unavailable",
      timedOut: false,
      responseReceived: false,
      redirectDetected: false,
      httpStatus: null,
      contentType: null,
      statusOk: false,
    };
  }

  const url = buildHealthUrl(env.AI_LAYOUT_CENTRAL_URL, env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.AI_LAYOUT_SERVICE_TOKEN}`,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return classifyFetchFailure(error);
  }

  const contentType = normalizeContentType(response);
  let statusOk = false;
  if (response.status === 200 && isJsonContentType(contentType)) {
    try {
      const body = await readHealthJson(response);
      statusOk = body?.status === "ok";
    } catch {
      return {
        ...classifyResponse(response, contentType, false),
        errorType: "invalid_json",
      };
    }
  }
  return classifyResponse(response, contentType, statusOk);
}
