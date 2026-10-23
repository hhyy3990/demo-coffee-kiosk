import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createMenuScreenModel, createMockMenuLayoutPlan } from "../src/accessibility/menuLayoutPlan.ts";
import { registerAiLayoutRoute } from "./ai-layout-relay.mjs";

const profile = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  viewportMode: null,
};
const model = createMenuScreenModel(390, profile);
const validPlan = createMockMenuLayoutPlan(model, { columns: 1, cardLayout: false });

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    AI_LAYOUT_RELAY_ENABLED: "true",
    AI_LAYOUT_CENTRAL_URL: "https://mock-qr.replit.dev",
    AI_LAYOUT_SERVICE_TOKEN: "test-service-token",
    AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: "test-external-access-token",
    ...overrides,
  };
}

async function withRelay(fetchImpl, env, run) {
  const app = express();
  registerAiLayoutRoute(app, { fetchImpl, env });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function postModel(origin, body = model) {
  return fetch(`${origin}/api/ai-layout/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("returns a validated plan from an injected in-process upstream mock", async () => {
  let calls = 0;
  await withRelay(async (url, init) => {
    calls += 1;
    const target = new URL(url);
    assert.equal(target.origin, "https://mock-qr.replit.dev");
    assert.equal(target.pathname, "/api/ai-layout/plan");
    assert.deepEqual([...target.searchParams.keys()], ["project-protection-bypass"]);
    assert.equal(
      target.searchParams.get("project-protection-bypass") === "test-external-access-token",
      true,
    );
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization === "Bearer test-service-token", true);
    assert.equal(init.headers.Authorization.includes("test-external-access-token"), false);
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), model);
    return Response.json(validPlan);
  }, enabledEnv(), async (origin) => {
    const response = await postModel(origin);
    assert.equal(response.status, 200);
    const publicBody = await response.text();
    assert.equal(publicBody.includes("test-external-access-token"), false);
    assert.equal(publicBody.includes("test-service-token"), false);
    assert.deepEqual(JSON.parse(publicBody), validPlan);
  });
  assert.equal(calls, 1);
});

test("rejects incorrect model IDs and any extra or user-data fields before upstream", async () => {
  let calls = 0;
  await withRelay(async () => {
    calls += 1;
    return Response.json(validPlan);
  }, enabledEnv(), async (origin) => {
    const badScreen = structuredClone(model);
    badScreen.screenId = "cafe.payment";
    const unknownField = { ...model, qrToken: "redacted-test-value" };
    const badScale = structuredClone(model);
    badScale.constraints.textScale = "unknown";
    for (const invalid of [badScreen, unknownField, badScale]) {
      const response = await postModel(origin, invalid);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "화면 구성 요청을 확인할 수 없어요." });
    }
  });
  assert.equal(calls, 0);
});

test("enforces the 16 KiB request limit with a normalized error", async () => {
  await withRelay(async () => {
    assert.fail("Oversized input must not call upstream");
  }, enabledEnv(), async (origin) => {
    const response = await postModel(origin, `"${"x".repeat(16 * 1024)}"`);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "요청 본문이 너무 커요." });
  });
});

test("does not call upstream when the relay is disabled or credentials are missing", async (t) => {
  let calls = 0;
  const neverFetch = async () => {
    calls += 1;
    throw new Error("unexpected fetch");
  };
  for (const env of [
    enabledEnv({ AI_LAYOUT_RELAY_ENABLED: "false" }),
    enabledEnv({ AI_LAYOUT_SERVICE_TOKEN: "" }),
    enabledEnv({ AI_LAYOUT_SERVICE_TOKEN: undefined }),
    enabledEnv({ AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: "" }),
    enabledEnv({ AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: undefined }),
    enabledEnv({ NODE_ENV: "production" }),
    enabledEnv({ NODE_ENV: "test" }),
    enabledEnv({ NODE_ENV: undefined }),
  ]) {
    await t.test(JSON.stringify({
      enabled: env.AI_LAYOUT_RELAY_ENABLED,
      hasToken: Boolean(env.AI_LAYOUT_SERVICE_TOKEN),
      nodeEnv: env.NODE_ENV,
    }), async () => withRelay(neverFetch, env, async (origin) => {
      const response = await postModel(origin);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "화면 구성 계획 API가 아직 설정되지 않았어요." });
    }));
  }
  assert.equal(calls, 0);
});

test("rejects untrusted, production, credentialed, or query-bearing relay URLs without fetching", async () => {
  let calls = 0;
  const invalidUrls = [
    "https://naebangsikqr.replit.app",
    "https://example.com",
    "https://mock-qr.replit.dev/?existing=parameter",
    "https://mock-qr.replit.dev/#fragment",
    "https://user:pass@mock-qr.replit.dev",
    "https://mock-qr.replit.dev:444",
    "http://mock-qr.replit.dev",
  ];
  for (const invalidUrl of invalidUrls) {
    await withRelay(async () => {
      calls += 1;
      return Response.json(validPlan);
    }, enabledEnv({ AI_LAYOUT_CENTRAL_URL: invalidUrl }), async (origin) => {
      const response = await postModel(origin);
      assert.equal(response.status, 503);
    });
  }
  assert.equal(calls, 0);
});

test("keeps both fake credentials out of public errors and application logs", async (t) => {
  const externalToken = "fake-external-token-for-leak-test";
  const serviceToken = "fake-service-token-for-leak-test";
  const leakedSecrets = [externalToken, serviceToken];
  const capturedLogs = [];
  const originalMethods = new Map();
  for (const method of ["debug", "info", "log", "warn", "error"]) {
    originalMethods.set(method, console[method]);
    console[method] = (...args) => capturedLogs.push(args.map(String).join(" "));
  }

  try {
    const errors = [
      { error: new Error(`network failure ${externalToken} ${serviceToken}`), status: 502 },
      { error: Object.assign(
        new Error(`timeout ${externalToken} ${serviceToken}`),
        { name: "TimeoutError" },
      ), status: 504 },
    ];
    for (const { error, status } of errors) {
      await withRelay(async () => {
        throw error;
      }, enabledEnv({
        AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: externalToken,
        AI_LAYOUT_SERVICE_TOKEN: serviceToken,
      }), async (origin) => {
        const response = await postModel(origin);
        const publicBody = await response.text();
        assert.equal(response.status, status);
        assert.equal(publicBody.includes(externalToken), false);
        assert.equal(publicBody.includes(serviceToken), false);
      });
    }
  } finally {
    for (const [method, original] of originalMethods) console[method] = original;
  }

  const allLogs = capturedLogs.join("\n");
  for (const secret of leakedSecrets) assert.equal(allLogs.includes(secret), false);
});

test("normalizes upstream HTTP failures and never forwards upstream body text", async (t) => {
  for (const status of [400, 401, 403, 404, 413, 429, 500, 502, 503]) {
    await t.test(`upstream ${status}`, async () => withRelay(
      async () => new Response(JSON.stringify({ error: "private provider detail" }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      enabledEnv(),
      async (origin) => {
        const response = await postModel(origin);
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "화면 구성 서비스를 사용할 수 없어요." });
      },
    ));
  }
});

test("rejects a malformed, oversized, or contract-invalid upstream plan", async (t) => {
  const invalidPlan = { ...validPlan, operations: [{ type: "setGridColumns" }] };
  const responses = [
    new Response("not json", { status: 200 }),
    new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
    Response.json(invalidPlan),
  ];
  for (const [index, mockedResponse] of responses.entries()) {
    await t.test(`invalid upstream response ${index + 1}`, async () => withRelay(
      async () => mockedResponse,
      enabledEnv(),
      async (origin) => {
        const response = await postModel(origin);
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "화면 구성 서비스를 사용할 수 없어요." });
      },
    ));
  }
});

test("maps upstream timeout to a generic 504 and connection errors to generic 502", async (t) => {
  const timedOut = new Error("internal timeout details");
  timedOut.name = "TimeoutError";
  for (const [error, status, message] of [
    [timedOut, 504, "화면 구성 서비스 응답이 늦어요."],
    [new Error("private network detail"), 502, "화면 구성 서비스를 사용할 수 없어요."],
  ]) {
    await t.test(message, async () => withRelay(
      async () => { throw error; },
      enabledEnv(),
      async (origin) => {
        const response = await postModel(origin);
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: message });
      },
    ));
  }
});

test("coalesces duplicate requests and reuses a validated result for 30 seconds", async () => {
  let calls = 0;
  await withRelay(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json(validPlan);
  }, enabledEnv(), async (origin) => {
    const [first, second] = await Promise.all([postModel(origin), postModel(origin)]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(await first.json(), validPlan);
    assert.deepEqual(await second.json(), validPlan);
    const cached = await postModel(origin);
    assert.equal(cached.status, 200);
    assert.deepEqual(await cached.json(), validPlan);
  });
  assert.equal(calls, 1);
});

test("one-shot development mode permits only one upstream attempt, including after failure", async () => {
  let calls = 0;
  const unavailable = () => new Response("unavailable", { status: 503 });
  await withRelay(async () => {
    calls += 1;
    return unavailable();
  }, enabledEnv({ AI_LAYOUT_RELAY_ONE_SHOT: "true" }), async (origin) => {
    const first = await postModel(origin);
    assert.equal(first.status, 502);
    assert.deepEqual(await first.json(), { error: "화면 구성 서비스를 사용할 수 없어요." });

    const compactModel = createMenuScreenModel(360, profile);
    const second = await postModel(origin, compactModel);
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: "개발용 화면 구성 시험은 이미 사용했어요." });
  });
  assert.equal(calls, 1);
});
