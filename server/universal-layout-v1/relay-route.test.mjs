import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { createUniversalLayoutModel, universalSha256 } from "./universal-layout-contract.ts";
import { demoCoffeeMenuPolicy } from "./demo-coffee-policy.ts";
import { registerUniversalLayoutRelayRoute } from "./relay-route.mjs";

const accessibility = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};
const input = {
  viewportClass: "regular",
  accessibility,
  orderedItemIds: ["coffee-01", "coffee-02"],
};
const env = {
  NODE_ENV: "development",
  UNIVERSAL_LAYOUT_RELAY_ENABLED: "true",
  AI_LAYOUT_RELAY_ENABLED: "false",
  AI_LAYOUT_RELAY_ONE_SHOT: "true",
  AI_LAYOUT_CENTRAL_URL: "https://central-mock.replit.dev",
  AI_LAYOUT_REPLIT_EXTERNAL_TOKEN: "external-test-secret",
  AI_LAYOUT_SERVICE_TOKEN: "service-test-secret",
};

function makeModel(value = input) {
  return createUniversalLayoutModel(demoCoffeeMenuPolicy, {
    viewportClass: value.viewportClass,
    accessibility: value.accessibility,
    componentState: [{
      id: "menu.product-list",
      itemCount: value.orderedItemIds.length,
      itemOrderHash: universalSha256({ orderedItemIds: value.orderedItemIds }),
    }],
  });
}

function makePlan(value = input, mutation = (plan) => plan) {
  const model = makeModel(value);
  return mutation({
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{ type: "setColumns", targetId: "menu.product-list", columns: 1 }],
  });
}

async function withServer(options, run) {
  const app = express();
  const logs = [];
  registerUniversalLayoutRelayRoute(app, {
    env: options.env ?? env,
    fetchImpl: options.fetchImpl ?? (async () => { throw new Error("unexpected-fetch"); }),
    logger: (line) => logs.push(line),
  });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin, logs);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function post(origin, body = input) {
  return fetch(`${origin}/api/dev/universal-layout/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("relay forwards only the validated Universal model and accepts a valid central one-column plan", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (url, request) => {
      calls += 1;
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.pathname, "/api/dev/universal-layout/plan");
      assert.equal(parsedUrl.searchParams.get("project-protection-bypass"), env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
      assert.equal(request.headers.Authorization, `Bearer ${env.AI_LAYOUT_SERVICE_TOKEN}`);
      const sentPayload = JSON.parse(request.body);
      assert.deepEqual(Object.keys(sentPayload), ["model"]);
      const sentModel = sentPayload.model;
      assert.equal(sentModel.hostId, "democoffee");
      assert.equal(sentModel.screenId, "cafe.menu");
      assert.equal(sentModel.components[0].itemOrderHash, makeModel().components[0].itemOrderHash);
      return new Response(JSON.stringify(makePlan()), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": "central-mock-123" },
      });
    },
  }, async (origin, logs) => {
    const response = await post(origin);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.plan.operations[0].columns, 1);
    assert.equal(payload.model.contractVersion, "universal-layout.v1");
    assert.equal(calls, 1);
    assert.ok(logs.some((line) => line.includes('"stage":"plan_validated"')));
    assert.ok(logs.some((line) => line.includes('"centralContentType":"application/json"')));
    const logText = logs.join("\n");
    assert.equal(logText.includes(env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN), false);
    assert.equal(logText.includes(env.AI_LAYOUT_SERVICE_TOKEN), false);
    assert.equal(logText.includes("central-mock.replit.dev"), false);
  });
});

test("relay rejects wrong hashes, wrong screens, and policy-disallowed plans", async () => {
  const plans = [
    makePlan(input, (plan) => ({ ...plan, structureHash: "0".repeat(64) })),
    makePlan(input, (plan) => ({ ...plan, screenId: "cafe.options" })),
    makePlan(input, (plan) => ({
      ...plan,
      operations: [{ ...plan.operations[0], columns: 6 }],
    })),
  ];
  for (const invalidPlan of plans) {
    await withServer({
      fetchImpl: async () => new Response(JSON.stringify(invalidPlan), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": "central-invalid-456" },
      }),
    }, async (origin, logs) => {
      const response = await post(origin);
      const payload = await response.json();
      assert.equal(response.status, 502);
      assert.equal(payload.error, "UPSTREAM_PLAN_INVALID");
      assert.ok(logs.some((line) => line.includes('"centralStatus":200')));
    });
  }
});

test("disabled relay blocks without calling upstream", async () => {
  let calls = 0;
  await withServer({
    env: { ...env, UNIVERSAL_LAYOUT_RELAY_ENABLED: "false" },
    fetchImpl: async () => { calls += 1; throw new Error("must-not-run"); },
  }, async (origin) => {
    const response = await post(origin);
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  });
});

test("production does not register the Development relay route", async () => {
  await withServer({
    env: { ...env, NODE_ENV: "production" },
    fetchImpl: async () => { throw new Error("must-not-run"); },
  }, async (origin) => {
    assert.equal((await post(origin)).status, 404);
  });
});

test("identical concurrent requests share one central call", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify(makePlan()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  }, async (origin) => {
    const [first, second] = await Promise.all([post(origin), post(origin)]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await post(origin)).status, 200);
    assert.equal(calls, 1);
  });
});
