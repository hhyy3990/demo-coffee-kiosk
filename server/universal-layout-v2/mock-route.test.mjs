import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerUniversalLayoutV2MockRoute } from "./mock-route.mjs";
import { demoCoffeeUniversalV2DevPolicy } from "./demo-coffee-dev-policy.ts";
import {
  createUniversalLayoutV2Model,
  universalSha256,
  validateUniversalLayoutV2Plan,
} from "./universal-v2-contract-export.ts";

const standard = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};
const orderedItemIds = ["americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea"];
const policies = [demoCoffeeUniversalV2DevPolicy];

async function withServer(env, run) {
  const app = express();
  registerUniversalLayoutV2MockRoute(app, { env });
  app.use((_req, res) => res.sendStatus(404));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

function makeModel(accessibility = standard) {
  return createUniversalLayoutV2Model(demoCoffeeUniversalV2DevPolicy, {
    viewportClass: "regular",
    accessibility,
    layoutCapabilities: [],
    componentState: [{
      id: "menu.product-list",
      itemCount: orderedItemIds.length,
      itemOrderHash: universalSha256({ orderedItemIds }),
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

test("Development Fake creates a real-screen v2 model and validates compact-grid", async () => {
  await withServer({ NODE_ENV: "development" }, async (origin) => {
    const response = await fetch(`${origin}/api/dev/universal-layout/v2/mock-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewportClass: "regular",
        accessibility: standard,
        orderedItemIds,
      }),
    });
    assert.equal(response.status, 200);
    const { model, plan } = await response.json();
    assert.equal(model.schemaVersion, 2);
    assert.equal(model.contractVersion, "universal-layout.v2");
    assert.equal(model.hostId, "democoffee");
    assert.equal(model.screenId, "cafe.menu");
    assert.equal(model.components[0].itemCount, orderedItemIds.length);
    assert.deepEqual(model.components[0].optionGroups, [{
      id: "arrangement",
      optionIds: ["compact-grid"],
    }]);
    assert.equal(plan.operations[0].type, "selectLayoutOption");
    assert.equal(plan.operations[0].targetId, "menu.product-list");
    assert.equal(plan.operations[0].groupId, "arrangement");
    assert.equal(plan.operations[0].optionId, "compact-grid");
    assert.notEqual(model.structureHash, "51616a81efd7fe21b9d215a697532924cacd3e37aff2c250af43d0944d910182");
    assert.equal(model.constraintHash, "6aabe7d629c36395e1cb12ec3b45085f077e8d8c445cdfbe676cc8fe0eed0d5e");
  });
});

test("v2 validator rejects unknown options, stale hashes, and mismatched model versions", () => {
  const model = makeModel();
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      planFor(model, (plan) => ({
        ...plan,
        operations: [{ ...plan.operations[0], optionId: "unregistered-grid" }],
      })),
      model,
      policies,
    ),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      planFor(model, (plan) => ({ ...plan, constraintHash: "0".repeat(64) })),
      model,
      policies,
    ),
    /PLAN_MODEL_MISMATCH/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      planFor(model, (plan) => ({ ...plan, schemaVersion: 1 })),
      model,
      policies,
    ),
  );
});

test("large text and large controls cannot resolve the compact-grid option", async () => {
  for (const accessibility of [
    { ...standard, textScale: "large" },
    { ...standard, buttonScale: "large" },
  ]) {
    const model = makeModel(accessibility);
    assert.deepEqual(model.components[0].optionGroups, undefined);
    assert.deepEqual(model.components[0].allowedColumns, [1]);
    assert.throws(
      () => validateUniversalLayoutV2Plan(planFor(model), model, policies),
      /UNSUPPORTED_PLAN_OPERATION/,
    );
    await withServer({ NODE_ENV: "development" }, async (origin) => {
      const response = await fetch(`${origin}/api/dev/universal-layout/v2/mock-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          viewportClass: "regular",
          accessibility,
          orderedItemIds,
        }),
      });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error, "UNSUPPORTED_PLAN_OPERATION");
    });
  }
});

test("v2 Mock route is unavailable outside Development", async () => {
  await withServer({ NODE_ENV: "production" }, async (origin) => {
    const response = await fetch(`${origin}/api/dev/universal-layout/v2/mock-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 404);
  });
});
