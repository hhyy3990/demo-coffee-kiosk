import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerUniversalLayoutMockRoute } from "./mock-route.mjs";

async function withServer(env, run) {
  const app = express();
  registerUniversalLayoutMockRoute(app, { env });
  app.use((_req, res) => res.sendStatus(404));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

const standard = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};
const orderedItemIds = ["americano", "latte", "cake-1"];

test("Development Mock returns server-created, contract-validated Universal v1 model and plan", async () => {
  await withServer({ NODE_ENV: "development" }, async (origin) => {
    const response = await fetch(`${origin}/api/dev/universal-layout/mock-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewportClass: "regular",
        accessibility: standard,
        orderedItemIds,
        columns: 2,
      }),
    });
    assert.equal(response.status, 200);
    const { model, plan } = await response.json();
    assert.equal(model.contractVersion, "universal-layout.v1");
    assert.equal(model.hostId, "democoffee");
    assert.equal(model.screenId, "cafe.menu");
    assert.equal(model.components[0].itemCount, orderedItemIds.length);
    assert.equal(plan.operations[0].type, "setColumns");
    assert.equal(plan.operations[0].targetId, "menu.product-list");
    assert.equal(plan.operations[0].columns, 2);
  });
});

test("Development Mock rejects policy-disallowed columns and malformed requests", async () => {
  await withServer({ NODE_ENV: "development" }, async (origin) => {
    const request = (payload) => fetch(`${origin}/api/dev/universal-layout/mock-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const compact = await request({
      viewportClass: "compact",
      accessibility: standard,
      orderedItemIds,
      columns: 2,
    });
    assert.equal(compact.status, 422);
    assert.equal((await compact.json()).error, "DISALLOWED_COLUMN_COUNT");
    const malformed = await request({
      viewportClass: "regular",
      accessibility: standard,
      orderedItemIds,
      columns: 1,
      plan: { operations: [] },
    });
    assert.equal(malformed.status, 400);
  });
});

test("Universal Mock route is not registered outside Development", async () => {
  await withServer({ NODE_ENV: "production" }, async (origin) => {
    const response = await fetch(`${origin}/api/dev/universal-layout/mock-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 404);
  });
});
