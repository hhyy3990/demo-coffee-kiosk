import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createUniversalLayoutV2Model, universalSha256 } from "./universal-v2-contract-export.ts";
import { demoCoffeeUniversalV2DevPolicy } from "./demo-coffee-dev-policy.ts";
import { registerUniversalLayoutV2RelayRoute } from "./relay-route.mjs";

const access = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};
const input = {
  viewportClass: "regular",
  accessibility: access,
  orderedItemIds: ["coffee-a", "coffee-b"],
};
const baseEnv = {
  NODE_ENV: "development",
  UNIVERSAL_LAYOUT_V2_RELAY_ENABLED: "true",
  AI_LAYOUT_CENTRAL_URL: "https://central-dev.replit.dev",
  AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: "test-external-token",
  AI_LAYOUT_SERVICE_TOKEN: "test-service-token",
};

function modelFor(value = input) {
  return createUniversalLayoutV2Model(demoCoffeeUniversalV2DevPolicy, {
    viewportClass: value.viewportClass,
    accessibility: value.accessibility,
    layoutCapabilities: [],
    componentState: [{
      id: "menu.product-list",
      itemCount: value.orderedItemIds.length,
      itemOrderHash: universalSha256({ orderedItemIds: value.orderedItemIds }),
    }],
  });
}

function planFor(model, mutation = (plan) => plan) {
  return mutation({
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{
      type: "selectLayoutOption",
      targetId: "menu.product-list",
      groupId: "arrangement",
      optionId: "compact-grid",
    }],
  });
}

async function withServer(options, run) {
  const app = express();
  const logs = [];
  registerUniversalLayoutV2RelayRoute(app, {
    env: options.env ?? baseEnv,
    fetchImpl: options.fetchImpl ?? (async () => { throw new Error("unexpected-fetch"); }),
    now: options.now,
    logger: (line) => logs.push(line),
  });
  app.use((_req, res) => res.sendStatus(404));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, logs);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

function post(origin, body = input) {
  return fetch(`${origin}/api/dev/universal-layout/v2/relay-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("v2 relay sends strict model envelope, validates top-level plan, and caches success", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (url, init) => {
      calls += 1;
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.pathname, "/api/dev/universal-layout/v2/fake-plan");
      assert.equal(parsedUrl.searchParams.get("project-protection-bypass"), baseEnv.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
      assert.equal(init.headers.Authorization, `Bearer ${baseEnv.AI_LAYOUT_SERVICE_TOKEN}`);
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ["model"]);
      assert.equal(body.model.contractVersion, "universal-layout.v2");
      assert.equal(body.model.hostId, "democoffee");
      return new Response(JSON.stringify(planFor(body.model)), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": "central-fake-1" },
      });
    },
  }, async (origin, logs) => {
    const response = await post(origin);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.plan.operations[0].optionId, "compact-grid");
    assert.equal(payload.model.contractVersion, "universal-layout.v2");
    const cached = await post(origin);
    assert.equal(cached.status, 200);
    assert.equal(calls, 1);
    assert.equal(logs.filter((line) => line.includes('"stage":"central_upstream_started"')).length, 1);
    assert.equal(logs.join("\n").includes(baseEnv.AI_LAYOUT_SERVICE_TOKEN), false);
    assert.equal(logs.join("\n").includes(baseEnv.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN), false);
    assert.equal(logs.join("\n").includes("central-dev.replit.dev"), false);
  });
});

test("identical concurrent v2 relay requests share one upstream attempt", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (_url, init) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const { model } = JSON.parse(init.body);
      return new Response(JSON.stringify(planFor(model)), { status: 200 });
    },
  }, async (origin, logs) => {
    const responses = await Promise.all([post(origin), post(origin)]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(calls, 1);
    assert.equal(logs.filter((line) => line.includes('"stage":"central_upstream_started"')).length, 1);
    assert.ok(logs.some((line) => line.includes('"stage":"duplicate_coalesced"')));
  });
});

test("invalid central plan is rejected without fallback, retry, or further upstream calls", async () => {
  const mutations = [
    (plan) => ({ ...plan, structureHash: "0".repeat(64) }),
    (plan) => ({ ...plan, constraintHash: "0".repeat(64) }),
    (plan) => ({ ...plan, contractVersion: "universal-layout.v1" }),
    (plan) => ({
      ...plan,
      operations: [{ ...plan.operations[0], optionId: "unregistered-option" }],
    }),
  ];
  for (const mutate of mutations) {
    let calls = 0;
    await withServer({
      fetchImpl: async (_url, init) => {
        calls += 1;
        const { model } = JSON.parse(init.body);
        return new Response(JSON.stringify(planFor(model, mutate)), { status: 200 });
      },
    }, async (origin, logs) => {
      const invalid = await post(origin);
      assert.equal(invalid.status, 502);
      assert.equal((await invalid.json()).error, "UPSTREAM_PLAN_INVALID");
      const capped = await post(origin, {
        ...input,
        orderedItemIds: ["different-item"],
      });
      assert.equal(capped.status, 429);
      assert.equal((await capped.json()).error, "UPSTREAM_REQUEST_LIMIT");
      assert.equal(calls, 1);
      assert.equal(logs.some((line) => line.includes("fallback")), false);
    });
  }
});

test("gate-off and Production do not call upstream; Production route is absent", async () => {
  let calls = 0;
  await withServer({
    env: { ...baseEnv, UNIVERSAL_LAYOUT_V2_RELAY_ENABLED: "false" },
    fetchImpl: async () => { calls += 1; throw new Error("unexpected upstream"); },
  }, async (origin) => {
    assert.equal((await post(origin)).status, 503);
    assert.equal(calls, 0);
  });
  await withServer({
    env: { ...baseEnv, NODE_ENV: "production" },
    fetchImpl: async () => { calls += 1; throw new Error("unexpected upstream"); },
  }, async (origin) => {
    assert.equal((await post(origin)).status, 404);
    assert.equal(calls, 0);
  });
});
