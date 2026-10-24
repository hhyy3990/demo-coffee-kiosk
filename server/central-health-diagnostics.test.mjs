import test from "node:test";
import assert from "node:assert/strict";
import { checkCentralHealth } from "./central-health-diagnostics.mjs";

const env = {
  NODE_ENV: "development",
  AI_LAYOUT_CENTRAL_URL: "https://central-health.replit.dev",
  AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: "test-external-token",
  AI_LAYOUT_SERVICE_TOKEN: "test-service-token",
};

test("uses the configured Development auth and classifies a healthy JSON response", async () => {
  let calls = 0;
  const result = await checkCentralHealth({
    env,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url.pathname, "/api/health");
      assert.equal([...url.searchParams.keys()].join(","), "project-protection-bypass");
      assert.equal(url.searchParams.get("project-protection-bypass"), env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, `Bearer ${env.AI_LAYOUT_SERVICE_TOKEN}`);
      assert.equal(init.redirect, "manual");
      return Response.json({ status: "ok" }, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Request-ID": "health-request-123",
        },
      });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    stage: "response",
    errorType: "health_ok",
    exceptionName: null,
    timedOut: false,
    responseReceived: true,
    redirectDetected: false,
    httpStatus: 200,
    contentType: "application/json",
    centralRequestId: "health-request-123",
    statusOk: true,
    hasRedirectLocation: false,
  });
  for (const secret of [env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN, env.AI_LAYOUT_SERVICE_TOKEN]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("detects a protection redirect without following or exposing its location", async () => {
  const result = await checkCentralHealth({
    env,
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "manual");
      return new Response("<html>private protection page</html>", {
        status: 302,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Location: "https://login.example.test/private-path?secret=hidden",
        },
      });
    },
  });

  assert.equal(result.errorType, "redirect_response");
  assert.equal(result.redirectDetected, true);
  assert.equal(result.hasRedirectLocation, true);
  assert.equal(result.httpStatus, 302);
  assert.equal(JSON.stringify(result).includes("login.example.test"), false);
  assert.equal(JSON.stringify(result).includes("secret=hidden"), false);
});

test("classifies DNS, TCP, TLS, and timeout failures without exception messages", async (t) => {
  const scenarios = [
    ["DNS", "ENOTFOUND", "dns_failure", false],
    ["TCP", "ECONNREFUSED", "connection_failure", false],
    ["TLS", "CERT_HAS_EXPIRED", "tls_failure", false],
    ["timeout", "UND_ERR_CONNECT_TIMEOUT", "timeout", true],
  ];
  for (const [label, code, errorType, timedOut] of scenarios) {
    await t.test(label, async () => {
      const error = new TypeError("private error detail");
      error.cause = { code, message: "private cause detail" };
      const result = await checkCentralHealth({
        env,
        fetchImpl: async () => { throw error; },
      });
      assert.equal(result.errorType, errorType);
      assert.equal(result.errorCode, code);
      assert.equal(result.timedOut, timedOut);
      assert.equal(result.responseReceived, false);
      assert.equal(JSON.stringify(result).includes("private"), false);
    });
  }

  await t.test("AbortSignal timeout", async () => {
    const error = new Error("private timeout detail");
    error.name = "TimeoutError";
    const result = await checkCentralHealth({
      env,
      fetchImpl: async () => { throw error; },
    });
    assert.equal(result.errorType, "timeout");
    assert.equal(result.exceptionName, "TimeoutError");
    assert.equal(result.timedOut, true);
  });
});

test("classifies HTML 404 and authentication responses from metadata only", async (t) => {
  await t.test("HTML 404", async () => {
    const result = await checkCentralHealth({
      env,
      fetchImpl: async () => new Response("<html>private 404 page</html>", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    });
    assert.equal(result.errorType, "html_404_or_protection_page");
    assert.equal(result.httpStatus, 404);
    assert.equal(result.contentType, "text/html");
    assert.equal(JSON.stringify(result).includes("private"), false);
  });

  await t.test("401 JSON", async () => {
    const result = await checkCentralHealth({
      env,
      fetchImpl: async () => Response.json({ error: "private auth detail" }, {
        status: 401,
      }),
    });
    assert.equal(result.errorType, "auth_failure");
    assert.equal(result.httpStatus, 401);
    assert.equal(JSON.stringify(result).includes("private"), false);
  });

  await t.test("403 HTML protection page", async () => {
    const result = await checkCentralHealth({
      env,
      fetchImpl: async () => new Response("<html>private auth page</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    });
    assert.equal(result.errorType, "html_protection_or_auth_page");
  });
});

test("refuses malformed base URLs and non-Development execution before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ status: "ok" });
  };
  const invalid = await checkCentralHealth({
    env: { ...env, AI_LAYOUT_CENTRAL_URL: "https://central-health.replit.dev/api" },
    fetchImpl,
  });
  const production = await checkCentralHealth({
    env: { ...env, NODE_ENV: "production" },
    fetchImpl,
  });
  assert.equal(invalid.errorType, "invalid_central_configuration");
  assert.equal(production.errorType, "development_only");
  assert.equal(calls, 0);
});
