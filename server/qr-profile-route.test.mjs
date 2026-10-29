import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { registerQrProfileRoute } from "./qr-profile-route.mjs";

const QR_TOKEN = "fake-qr-token-for-route-tests";
const PRODUCTION_ACCESS_TOKEN = "fake-production-access-token";
const validProfile = {
  schemaVersion: 5,
  updatedAt: "2026-10-29T00:00:00.000Z",
  preferences: { scrollGuidance: true },
};

async function withRoute({ env, fetchImpl, logger = { info() {} } }, run) {
  const app = express();
  registerQrProfileRoute(app, { env, fetchImpl, logger });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, logger);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function postProfile(origin, token = QR_TOKEN) {
  return fetch(`${origin}/api/qr-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

for (const nodeEnv of ["development", "production"]) {
  test(`always sends the Production QR bearer token from NODE_ENV=${nodeEnv}`, async () => {
    const entries = [];
    let calls = 0;
    await withRoute({
      env: { NODE_ENV: nodeEnv, QR_PROFILE_PRODUCTION_ACCESS_TOKEN: PRODUCTION_ACCESS_TOKEN },
      logger: { info: (_event, fields) => entries.push(fields) },
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url, "https://naebangsikqr.replit.app/api/profiles/resolve");
        assert.equal(init.method, "POST");
        assert.equal(init.headers.Authorization, `Bearer ${PRODUCTION_ACCESS_TOKEN}`);
        assert.deepEqual(JSON.parse(init.body), { token: QR_TOKEN });
        assert.equal(init.redirect, "manual");
        return Response.json(validProfile, {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      },
    }, async (origin) => {
      const response = await postProfile(origin);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), validProfile);
    });
    assert.equal(calls, 1);
    assert.deepEqual(entries, [{ status: 200, contentType: "application/json" }]);
  });
}

test("a JSON 404 remains an unavailable QR and does not forward upstream error content", async () => {
  const entries = [];
  await withRoute({
    env: { QR_PROFILE_PRODUCTION_ACCESS_TOKEN: PRODUCTION_ACCESS_TOKEN },
    logger: { info: (_event, fields) => entries.push(fields) },
    fetchImpl: async () => Response.json(
      { message: "private upstream detail" },
      { status: 404 },
    ),
  }, async (origin) => {
    const response = await postProfile(origin);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "사용할 수 없는 QR이에요." });
  });
  assert.deepEqual(entries, [{ status: 404, contentType: "application/json" }]);
});

test("a 307 is not followed and is returned as a safe gateway error", async () => {
  const entries = [];
  let calls = 0;
  await withRoute({
    env: { QR_PROFILE_PRODUCTION_ACCESS_TOKEN: PRODUCTION_ACCESS_TOKEN },
    logger: { info: (_event, fields) => entries.push(fields) },
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.redirect, "manual");
      return new Response(null, {
        status: 307,
        headers: { Location: "https://private.example/login" },
      });
    },
  }, async (origin) => {
    const response = await postProfile(origin);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "중앙 QR 서비스에 연결할 수 없어요." });
  });
  assert.equal(calls, 1);
  assert.deepEqual(entries, [{ status: 307, contentType: null }]);
});

for (const status of [401, 403]) {
  test(`a central ${status} is safely rejected and recorded without response details`, async () => {
    const entries = [];
    await withRoute({
      env: { QR_PROFILE_PRODUCTION_ACCESS_TOKEN: PRODUCTION_ACCESS_TOKEN },
      logger: { info: (_event, fields) => entries.push(fields) },
      fetchImpl: async () => Response.json(
        { message: "private upstream detail" },
        { status },
      ),
    }, async (origin) => {
      const response = await postProfile(origin);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "중앙 QR 서비스에 연결할 수 없어요." });
    });
    assert.deepEqual(entries, [{ status, contentType: "application/json" }]);
  });
}

test("a 200 HTML response is rejected without parsing or forwarding the HTML", async () => {
  const entries = [];
  await withRoute({
    env: { QR_PROFILE_PRODUCTION_ACCESS_TOKEN: PRODUCTION_ACCESS_TOKEN },
    logger: { info: (_event, fields) => entries.push(fields) },
    fetchImpl: async () => new Response("<html>login</html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  }, async (origin) => {
    const response = await postProfile(origin);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "중앙 QR 서비스에 연결할 수 없어요." });
  });
  assert.deepEqual(entries, [{ status: 200, contentType: "text/html" }]);
});

test("missing Production QR credentials fail locally without an upstream request", async () => {
  let calls = 0;
  await withRoute({
    env: { NODE_ENV: "production" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not be called");
    },
  }, async (origin) => {
    const response = await postProfile(origin);
    assert.equal(response.status, 503);
  });
  assert.equal(calls, 0);
});
