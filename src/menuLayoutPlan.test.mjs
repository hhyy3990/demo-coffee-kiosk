import test from "node:test";
import assert from "node:assert/strict";
import {
  createMenuPlanGate,
  createMenuScreenModel,
  createMockMenuLayoutPlan,
  validateMenuScreenModel,
  validateMenuLayoutPlan,
} from "./accessibility/menuLayoutPlan.ts";
import { requestMenuLayoutPlan } from "./accessibility/requestMenuLayoutPlan.ts";

const profile = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  viewportMode: null,
};

function context(width = 390, currentProfile = profile) {
  return createMenuScreenModel(width, currentProfile);
}

test("local screen-model validation accepts canonical models and rejects contract mutations", () => {
  const generated = context(390, {
    textSize: "large",
    buttonSize: "large",
    contrast: "high",
    viewportMode: null,
  });
  assert.deepEqual(validateMenuScreenModel(generated), generated);

  const alteredConstraint = structuredClone(generated);
  alteredConstraint.constraints.allowedColumns = [1, 2];
  assert.equal(validateMenuScreenModel(alteredConstraint), null);

  const extraField = { ...generated, userData: "must not pass" };
  assert.equal(validateMenuScreenModel(extraField), null);
});

test("manual AI plan request sends one safe model and accepts only a validated response", async () => {
  const model = context();
  const expectedPlan = createMockMenuLayoutPlan(model, { columns: 1, cardLayout: false });
  let calls = 0;
  const result = await requestMenuLayoutPlan(model, async (url, init) => {
    calls += 1;
    assert.equal(url, "/api/ai-layout/plan");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), model);
    return Response.json(expectedPlan, { headers: { "X-Request-ID": "relay-request-1" } });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.plan, validateMenuLayoutPlan(expectedPlan, model));
  assert.equal(result.stage, "validated");
  assert.equal(result.status, 200);
  assert.equal(result.requestId, "relay-request-1");
});

test("manual AI plan request rejects HTTP failures and invalid plans without retrying", async () => {
  const model = context();
  const invalidPlan = { ...createMockMenuLayoutPlan(model), extra: "not allowed" };
  for (const [response, stage] of [
    [new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }), "http_error"],
    [Response.json(invalidPlan), "plan_validation_error"],
    [new Response("not-json", { status: 200 }), "json_parse_error"],
  ]) {
    let calls = 0;
    const result = await requestMenuLayoutPlan(model, async () => {
      calls += 1;
      return response;
    });
    assert.equal(result.plan, null);
    assert.equal(result.stage, stage);
    assert.equal(calls, 1);
  }
});

test("safe menu model contains only explicit layout structure and constraints", () => {
  const model = context();
  assert.equal(model.hostId, "democoffee");
  assert.equal(model.screenId, "cafe.menu");
  assert.equal(model.schemaVersion, 2);
  assert.equal(model.structureVersion, "menu.v2");
  assert.equal(model.viewportClass, "regular");
  assert.equal(model.structureHash, context(360).structureHash);
  assert.notEqual(model.constraintHash, context(360).constraintHash);
  assert.equal(model.constraints.defaultColumns, 2);
  assert.deepEqual(context(360).constraints.allowedColumns, [1]);
  assert.equal(model.constraints.minimumTouchTargetPx, 44);
  assert.deepEqual(model.allowedOperations, ["setGroupColumns", "setGroupFlow", "setChildBasis"]);
  assert.deepEqual(model.constraints.allowedColumns, [1, 2]);
  assert.equal(model.groups[0].id, "menu.product-list");
  assert.deepEqual(model.groups[0].mutableProperties, ["columns"]);
  assert.deepEqual(model.protectedProperties, [
    "menu.product-list.items",
    "menu.product-list.order",
    "menu.category-navigation",
    "menu.fixed-controls",
    "menu.product-content",
    "menu.product-action.behavior",
  ]);
  assert.equal(JSON.stringify(model).includes("Americano"), false);
  assert.equal(JSON.stringify(model).includes("price"), true); // semantic role only
  assert.equal(JSON.stringify(model).includes("quantity"), false);
  assert.equal(JSON.stringify(model).includes("token"), false);
});

test("column-only and card-only plans validate independently", () => {
  const model = context();
  assert.deepEqual(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(model, { columns: 1, cardLayout: false }), model,
  ), {
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: "regular",
    columns: 1,
    gapPx: null,
    imageBasisPercent: null,
    imageMinimumPx: null,
  });

  const compactModel = context(360);
  assert.deepEqual(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(compactModel, { columns: null, cardLayout: true }), compactModel,
  ), {
    structureHash: compactModel.structureHash,
    constraintHash: compactModel.constraintHash,
    viewportClass: "compact",
    columns: null,
    gapPx: 12,
    imageBasisPercent: 25,
    imageMinimumPx: 76,
  });
});

test("full plan explicitly chooses one column and retains card layout operations", () => {
  const model = context();
  const plan = createMockMenuLayoutPlan(model);
  assert.deepEqual(plan.operations.map((operation) => operation.type), [
    "setGroupColumns", "setGroupFlow", "setChildBasis",
  ]);
  assert.deepEqual(validateMenuLayoutPlan(plan, model), {
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: "regular",
    columns: 1,
    gapPx: 12,
    imageBasisPercent: 25,
    imageMinimumPx: 76,
  });
});

test("rejects unknown fields, targets, and operations", () => {
  const model = context();
  const plan = createMockMenuLayoutPlan(model);
  assert.equal(validateMenuLayoutPlan({ ...plan, html: "<div>" }, model), null);
  const badTarget = structuredClone(plan);
  badTarget.operations[0].targetId = "menu.payment";
  assert.equal(validateMenuLayoutPlan(badTarget, model), null);
  const badOperation = structuredClone(plan);
  badOperation.operations[0].type = "setGridColumns";
  assert.equal(validateMenuLayoutPlan(badOperation, model), null);
});

test("rejects unsafe columns, column/card conflicts, and oversized profiles", () => {
  const compact = context(360);
  assert.equal(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(compact, { columns: 2, cardLayout: false }), compact,
  ), null);

  const standard = context();
  assert.equal(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(standard, { columns: 2, cardLayout: true }), standard,
  ), null);

  const largeText = context(390, { ...profile, textSize: "large" });
  assert.deepEqual(largeText.constraints.allowedColumns, [1]);
  assert.equal(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(largeText, { columns: 2, cardLayout: false }), largeText,
  ), null);

  const largeButtons = context(390, { ...profile, buttonSize: "large" });
  assert.deepEqual(largeButtons.constraints.allowedColumns, [1]);
  assert.equal(validateMenuLayoutPlan(
    createMockMenuLayoutPlan(largeButtons, { columns: 2, cardLayout: false }), largeButtons,
  ), null);
});

test("rejects duplicate, out-of-order, incomplete, and out-of-range operations", () => {
  const model = context();
  const duplicate = createMockMenuLayoutPlan(model);
  duplicate.operations = [...duplicate.operations, duplicate.operations[0]];
  assert.equal(validateMenuLayoutPlan(duplicate, model), null);

  const outOfOrder = createMockMenuLayoutPlan(model);
  outOfOrder.operations = [outOfOrder.operations[0], outOfOrder.operations[2], outOfOrder.operations[1]];
  assert.equal(validateMenuLayoutPlan(outOfOrder, model), null);

  const incompleteCard = createMockMenuLayoutPlan(model);
  incompleteCard.operations.pop();
  assert.equal(validateMenuLayoutPlan(incompleteCard, model), null);

  const unsupportedColumns = createMockMenuLayoutPlan(model);
  unsupportedColumns.operations[0].columns = 3;
  assert.equal(validateMenuLayoutPlan(unsupportedColumns, model), null);

  const unsafeGap = createMockMenuLayoutPlan(model);
  unsafeGap.operations[1].gapPx = 100;
  assert.equal(validateMenuLayoutPlan(unsafeGap, model), null);

  const oversizedImage = createMockMenuLayoutPlan(model);
  oversizedImage.operations[2].basisPercent = 90;
  assert.equal(validateMenuLayoutPlan(oversizedImage, model), null);
});

test("rejects stale structure, viewport, profile, and easy-language constraints", () => {
  const plan = createMockMenuLayoutPlan(context());
  assert.equal(validateMenuLayoutPlan(plan, context(360)), null);
  assert.equal(validateMenuLayoutPlan(plan, context(390, {
    ...profile,
    textSize: "extraLarge",
    viewportMode: { mode: "bottom", heightPercent: 70 },
  })), null);
  const easyLanguage = context(390, { ...profile, easyLanguage: true });
  assert.equal(easyLanguage.constraints.viewportModePercent, 80);
  assert.equal(validateMenuLayoutPlan(plan, easyLanguage), null);
  assert.equal(validateMenuLayoutPlan({
    ...plan,
    structureHash: "stale",
  }, context()), null);
});

test("plan gate invalidates results from previous screen, profile, or viewport generations", () => {
  const gate = createMenuPlanGate();
  const model = context();
  const ticket = gate.capture(model);
  assert.equal(gate.canApply(ticket, model), true);

  gate.invalidate();
  assert.equal(gate.canApply(ticket, model), false);

  const freshTicket = gate.capture(model);
  assert.equal(gate.canApply(freshTicket, context(360)), false);
  assert.equal(gate.canApply(freshTicket, context(390, {
    ...profile,
    buttonSize: "large",
  })), false);
});
