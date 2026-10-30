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
const eventId = "3f7c8c98-265f-4e44-8a75-a7c019a4a931";
const secondEventId = "3f7c8c98-265f-4e44-8a75-a7c019a4a932";
const input = { eventId, viewportClass: "regular", accessibility: access, orderedItemIds: itemIds };
const enabledEnv = {
  NODE_ENV: "production",
  UNIVERSAL_LAYOUT_V2_PRODUCTION_AI_ENABLED: "true",
  UNIVERSAL_LAYOUT_V2_PRODUCTION_HOST_TOKEN: "host-test-token",
  UNIVERSAL_LAYOUT_V2_PRODUCTION_EXTERNAL_ACCESS_TOKEN: "production-external-test-token",
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

test("Production relay fails closed before fetch when either Production credential is missing", async () => {
  for (const missingSecret of [
    "UNIVERSAL_LAYOUT_V2_PRODUCTION_HOST_TOKEN",
    "UNIVERSAL_LAYOUT_V2_PRODUCTION_EXTERNAL_ACCESS_TOKEN",
  ]) {
    let calls = 0;
    const env = { ...enabledEnv };
    delete env[missingSecret];
    // A Development external token must not satisfy the Production credential.
    if (missingSecret === "UNIVERSAL_LAYOUT_V2_PRODUCTION_EXTERNAL_ACCESS_TOKEN") {
      env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN = "development-external-test-token";
    }
    await withServer({
      env,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must-not-fetch");
      },
    }, async (origin) => {
      const response = await post(origin);
      assert.equal(response.status, 503, missingSecret);
      assert.equal((await response.json()).error, "RELAY_NOT_CONFIGURED");
    });
    assert.equal(calls, 0, missingSecret);
  }
});

test("Production relay uses the event ID as idempotency key and deduplicates one event", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://naebangsikqr.replit.app/api/production/universal-layout/v2/openai-plan");
      assert.equal(init.headers["X-Host-AI-Token"], "host-test-token");
      assert.equal(init.headers.Authorization, "Bearer production-external-test-token");
      assert.equal(init.headers["Idempotency-Key"], eventId);
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
    assert.equal(logs.join("\n").includes("production-external-test-token"), false);
    assert.equal(logs.join("\n").includes("americano"), false);
  });
});

test("a new explicit QR event gets a separate provider call", async () => {
  let calls = 0;
  const idempotencyKeys = [];
  await withServer({
    fetchImpl: async (_url, init) => {
      calls += 1;
      idempotencyKeys.push(init.headers["Idempotency-Key"]);
      return Response.json(planFor(JSON.parse(init.body).model));
    },
  }, async (origin) => {
    assert.equal((await post(origin)).status, 200);
    assert.equal((await post(origin, { ...input, eventId: secondEventId })).status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(idempotencyKeys, [eventId, secondEventId]);
  });
});

test("Production relay rejects malformed event IDs before any provider request", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("unexpected-fetch");
    },
  }, async (origin) => {
    for (const malformed of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
      const response = await post(origin, { ...input, eventId: malformed });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
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

test("Production relay does not follow redirects or retry an event after failure", async () => {
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
    assert.equal((await post(origin)).status, 502);
    assert.equal(calls, 1);
  });
});

test("Production relay safely rejects auth, quota, and gateway statuses without retrying", async () => {
  for (const status of [401, 403, 429, 502, 503]) {
    let calls = 0;
    await withServer({
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ error: "private upstream response" }, { status });
      },
    }, async (origin) => {
      const response = await post(origin);
      assert.equal(response.status, 502, `central ${status}`);
      assert.deepEqual(await response.json(), { error: "UPSTREAM_FAILURE" });
      assert.equal((await post(origin)).status, 502, `duplicate central ${status}`);
    });
    assert.equal(calls, 1, `central ${status}`);
  }
});

test("Production relay safely handles timeout without retrying the provider call", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("simulated timeout");
      error.name = "TimeoutError";
      throw error;
    },
  }, async (origin) => {
    assert.equal((await post(origin)).status, 502);
    assert.deepEqual(await (await post(origin)).json(), { error: "UPSTREAM_FAILURE" });
    assert.equal(calls, 1);
  });
});
