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
    mode: options.mode ?? "mock",
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

async function post(origin, body = input, path = "/api/dev/universal-layout/plan") {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Mock relay accepts a top-level central plan and returns the local model-plan envelope", async () => {
  let calls = 0;
  await withServer({
    fetchImpl: async (url, request) => {
      calls += 1;
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.pathname, "/api/dev/universal-layout/plan");
      assert.equal(request.method, "POST");
      assert.deepEqual([...parsedUrl.searchParams.keys()], ["project-protection-bypass"]);
      assert.equal(parsedUrl.searchParams.get("project-protection-bypass"), env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
      assert.equal(request.headers.Authorization, `Bearer ${env.AI_LAYOUT_SERVICE_TOKEN}`);
      assert.equal(request.redirect, "error");
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

test("OpenAI relay uses its isolated Development gate and validates the shared v1 plan", async () => {
  const openAiEnv = {
    ...env,
    UNIVERSAL_LAYOUT_RELAY_ENABLED: "false",
    UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true",
  };
  let calls = 0;
  await withServer({
    mode: "openai",
    env: openAiEnv,
    fetchImpl: async (url, request) => {
      calls += 1;
      assert.equal(new URL(url).pathname, "/api/dev/universal-layout/openai-plan");
      const parsedUrl = new URL(url);
      assert.deepEqual([...parsedUrl.searchParams.keys()], ["project-protection-bypass"]);
      assert.equal(parsedUrl.searchParams.get("project-protection-bypass"), env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN);
      assert.deepEqual(Object.keys(JSON.parse(request.body)), ["model"]);
      assert.equal(request.headers.Authorization, `Bearer ${env.AI_LAYOUT_SERVICE_TOKEN}`);
      assert.equal(request.redirect, "error");
      return new Response(JSON.stringify(makePlan()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  }, async (origin, logs) => {
    const response = await post(origin, input, "/api/dev/universal-layout/openai-plan");
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.plan.operations[0].columns, 1);
    assert.ok(logs.some((line) => line.includes('"mode":"openai"')));
    assert.equal(calls, 1);
  });
});

test("OpenAI relay timeout is reported without a retry", async () => {
  const openAiEnv = {
    ...env,
    UNIVERSAL_LAYOUT_RELAY_ENABLED: "false",
    UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true",
  };
  let calls = 0;
  await withServer({
    mode: "openai",
    env: openAiEnv,
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
  }, async (origin, logs) => {
    const response = await post(origin, input, "/api/dev/universal-layout/openai-plan");
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.ok(logs.some((line) => line.includes('"failureClass":"timeout"')));
  });
});

test("OpenAI relay rejects an invalid plan and coalesces duplicate requests", async () => {
  const openAiEnv = {
    ...env,
    UNIVERSAL_LAYOUT_RELAY_ENABLED: "false",
    UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true",
  };
  let calls = 0;
  await withServer({
    mode: "openai",
    env: openAiEnv,
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify(makePlan()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  }, async (origin) => {
    const path = "/api/dev/universal-layout/openai-plan";
    const [first, second] = await Promise.all([
      post(origin, input, path),
      post(origin, input, path),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 1);
  });
});

test("OpenAI relay rejects a two-column plan under the large-text accessibility policy", async () => {
  const openAiEnv = {
    ...env,
    UNIVERSAL_LAYOUT_RELAY_ENABLED: "false",
    UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true",
  };
  const largeInput = {
    ...input,
    accessibility: { ...accessibility, textScale: "large" },
  };
  const forbiddenPlan = makePlan(largeInput, (plan) => ({
    ...plan,
    operations: [{ ...plan.operations[0], columns: 2 }],
  }));
  await withServer({
    mode: "openai",
    env: openAiEnv,
    fetchImpl: async () => new Response(JSON.stringify(forbiddenPlan), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  }, async (origin) => {
    const response = await post(
      origin,
      largeInput,
      "/api/dev/universal-layout/openai-plan",
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "UPSTREAM_PLAN_INVALID");
  });
});

test("Mock and OpenAI relays reject central model-plan envelopes", async () => {
  for (const mode of ["mock", "openai"]) {
    const modeEnv = {
      ...env,
      UNIVERSAL_LAYOUT_RELAY_ENABLED: mode === "mock" ? "true" : "false",
      UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: mode === "openai" ? "true" : "false",
    };
    const centralEnvelope = {
      model: makeModel(),
      plan: makePlan(),
    };
    await withServer({
      mode,
      env: modeEnv,
      fetchImpl: async () => new Response(JSON.stringify(centralEnvelope), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    }, async (origin) => {
      const path = mode === "openai"
        ? "/api/dev/universal-layout/openai-plan"
        : "/api/dev/universal-layout/plan";
      const response = await post(origin, input, path);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, "UPSTREAM_PLAN_INVALID");
    });
  }
});

test("OpenAI relay blocks when its gate is off or Mock relay is enabled", async () => {
  for (const openAiEnv of [
    { ...env, UNIVERSAL_LAYOUT_RELAY_ENABLED: "false", UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "false" },
    { ...env, UNIVERSAL_LAYOUT_RELAY_ENABLED: "true", UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true" },
  ]) {
    let calls = 0;
    await withServer({
      mode: "openai",
      env: openAiEnv,
      fetchImpl: async () => { calls += 1; throw new Error("must-not-run"); },
    }, async (origin) => {
      const response = await post(origin, input, "/api/dev/universal-layout/openai-plan");
      assert.equal(response.status, 503);
      assert.equal(calls, 0);
    });
  }
});

test("OpenAI relay route is not registered in Production", async () => {
  await withServer({
    mode: "openai",
    env: {
      ...env,
      NODE_ENV: "production",
      UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: "true",
    },
    fetchImpl: async () => { throw new Error("must-not-run"); },
  }, async (origin) => {
    assert.equal(
      (await post(origin, input, "/api/dev/universal-layout/openai-plan")).status,
      404,
    );
  });
});

test("central HTML 404 is classified without exposing response or credentials", async () => {
  const privateBody = "<html>private protection page</html>";
  await withServer({
    fetchImpl: async () => new Response(privateBody, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  }, async (origin, logs) => {
    const response = await post(origin);
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.error, "UPSTREAM_HTTP_ERROR");
    const logText = logs.join("\n");
    assert.ok(logText.includes('"centralStatus":404'));
    assert.ok(logText.includes('"centralContentType":"text/html"'));
    assert.ok(logText.includes('"failureClass":"central_http_error"'));
    assert.equal(logText.includes(privateBody), false);
    assert.equal(logText.includes(env.AI_LAYOUT_REPLIT_EXTERNAL_TOKEN), false);
    assert.equal(logText.includes(env.AI_LAYOUT_SERVICE_TOKEN), false);
    assert.equal(logText.includes(env.AI_LAYOUT_CENTRAL_URL), false);
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
  for (const mode of ["mock", "openai"]) {
    for (const invalidPlan of plans) {
      const modeEnv = {
        ...env,
        UNIVERSAL_LAYOUT_RELAY_ENABLED: mode === "mock" ? "true" : "false",
        UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED: mode === "openai" ? "true" : "false",
      };
      await withServer({
        mode,
        env: modeEnv,
        fetchImpl: async () => new Response(JSON.stringify(invalidPlan), {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Request-ID": "central-invalid-456" },
        }),
      }, async (origin, logs) => {
        const path = mode === "openai"
          ? "/api/dev/universal-layout/openai-plan"
          : "/api/dev/universal-layout/plan";
        const response = await post(origin, input, path);
        const payload = await response.json();
        assert.equal(response.status, 502);
        assert.equal(payload.error, "UPSTREAM_PLAN_INVALID");
        assert.ok(logs.some((line) => line.includes('"centralStatus":200')));
      });
    }
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
