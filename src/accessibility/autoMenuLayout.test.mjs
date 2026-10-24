import test from "node:test";
import assert from "node:assert/strict";
import {
  createMenuScreenModel,
  createMockMenuLayoutPlan,
  validateMenuLayoutPlan,
} from "./menuLayoutPlan.ts";
import { createAutoMenuLayoutCoordinator } from "./autoMenuLayout.ts";

const profile = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  viewportMode: null,
};

const model = createMenuScreenModel(390, profile);
const validatedMock = validateMenuLayoutPlan(createMockMenuLayoutPlan(model), model);

test("automatic flow deduplicates concurrent runs and caches validated plans on re-entry", async () => {
  const coordinator = createAutoMenuLayoutCoordinator();
  let calls = 0;
  const request = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return validatedMock;
  };

  const [first, duplicate] = await Promise.all([
    coordinator.run(model, request),
    coordinator.run(model, request),
  ]);
  const reentry = await coordinator.run(model, request);

  assert.equal(calls, 1);
  assert.deepEqual(first.plan, validatedMock);
  assert.deepEqual(duplicate.plan, validatedMock);
  assert.equal(reentry.cached, true);
});

test("profile or viewport invalidation discards an older in-flight response", async () => {
  const coordinator = createAutoMenuLayoutCoordinator();
  let resolveRequest;
  const pending = coordinator.run(model, () => new Promise((resolve) => {
    resolveRequest = resolve;
  }));
  coordinator.invalidate();
  resolveRequest(validatedMock);
  const result = await pending;

  assert.equal(result.plan, null);
  assert.equal(result.stale, true);
  assert.equal((await coordinator.run(model, async () => validatedMock)).cached, false);
});

test("failed or invalid plans are not cached and can fall back to the original layout", async () => {
  const coordinator = createAutoMenuLayoutCoordinator();
  let calls = 0;
  const rejected = await coordinator.run(model, async () => {
    calls += 1;
    return null;
  });
  const recovered = await coordinator.run(model, async () => {
    calls += 1;
    return validatedMock;
  });

  assert.equal(rejected.plan, null);
  assert.deepEqual(recovered.plan, validatedMock);
  assert.equal(calls, 2);
});

test("mock plan uses the same schema validator and supports 360px and 390px models", () => {
  for (const width of [360, 390]) {
    const currentModel = createMenuScreenModel(width, profile);
    const plan = createMockMenuLayoutPlan(currentModel);
    const validated = validateMenuLayoutPlan(plan, currentModel);
    assert.ok(validated);
    assert.equal(validated.columns, 1);
  }
});
