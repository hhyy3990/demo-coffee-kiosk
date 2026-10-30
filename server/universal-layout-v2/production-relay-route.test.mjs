import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  createUniversalLayoutV2Model,
  universalSha256,
} from "./universal-v2-contract-export.ts";
import {
  demoCoffeeUniversalV2ProductionPolicy,
} from "./demo-coffee-production-policy.ts";
import {
  registerUniversalLayoutV2ProductionRelayRoute,
} from "./production-relay-route.mjs";

const access = {
  textScale: "large",
  buttonScale: "large",
  contrast: "high",
  viewportMode: { mode: "bottom", heightPercent: 70 },
};
const itemIds = ["americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea"];
const input = { viewportClass: "regular", accessibility: access, orderedItemIds: itemIds };
const enabledEnv = {
  NODE_ENV: "production",
  UNIVERSAL_LAYOUT_V2_PRODUCTION_AI_ENABLED: "true",
  UNIVERSAL_LAYOUT_V2_PRODUCTION_HOST_TOKEN: "host-test-token",
};

function modelFor(value = input) {
  return createUniversalLayoutV2Model(demoCoffeeUniversalV2ProductionPolicy, {
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

function planFor(model) {
  return {
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
      optionId: "single-column-list",
    }],
  };
}

async function withServer(options, run) {
  const app = express();
  const logs = [];
  registerUniversalLayoutV2ProductionRelayRoute(app, {
    env: options.env ?? enabledEnv,
    fetchImpl: options.fetchImpl ?? (async () => { throw new Error("unexpected-fetch"); }),
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
  return fetch(`${origin}/api/production/universal-layout/v2/openai-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Production v2 relay is inert unless its server gate is explicitly enabled", async () => {
  await withServer({
    env: { NODE_ENV: "production", UNIVERSAL_LAYOUT_V2_PRODUCTION_AI_ENABLED: "false" },
  }, async (origin) => {
    const response = await post(origin);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "RELAY_DISABLED");
  });
});

test("Production relay sends the production contract, validates the top-level plan, and deduplicates", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://naebangsikqr.replit.app/api/production/universal-layout/v2/openai-plan");
      assert.equal(init.headers["X-Host-AI-Token"], "host-test-token");
      assert.match(init.headers["Idempotency-Key"], /^[a-f0-9]{64}$/);
      assert.equal(init.redirect, "manual");
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ["model"]);
      assert.equal(body.model.hostId, "democoffee");
      return Response.json(planFor(body.model), {
        headers: { "X-Request-ID": "central-production-1" },
      });
    },
  }, async (origin, logs) => {
    const response = await post(origin);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.model.structureVersion, "menu.v2");
    assert.equal(payload.plan.operations[0].optionId, "single-column-list");
    assert.equal((await post(origin)).status, 200);
    assert.equal(calls, 1);
    assert.ok(logs.some((line) => line.includes('"stage":"duplicate_cached"')));
    assert.equal(logs.join("\n").includes("host-test-token"), false);
    assert.equal(logs.join("\n").includes("americano"), false);
  });
});

test("Production relay rejects altered item order or unsupported accessibility before fetch", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("unexpected-fetch");
    },
  }, async (origin) => {
    const reordered = [...itemIds].reverse();
    const response = await post(origin, { ...input, orderedItemIds: reordered });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    const wrongProfile = await post(origin, {
      ...input,
      accessibility: { ...access, contrast: "standard" },
    });
    assert.equal(wrongProfile.status, 400);
    assert.equal(calls, 0);
  });
});

test("Production relay does not follow redirects or retry upstream failures", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.redirect, "manual");
      return new Response(null, { status: 307, headers: { Location: "https://example.invalid/blocked" } });
    },
  }, async (origin) => {
    const response = await post(origin);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "UPSTREAM_FAILURE");
    assert.equal(calls, 1);
  });
});
