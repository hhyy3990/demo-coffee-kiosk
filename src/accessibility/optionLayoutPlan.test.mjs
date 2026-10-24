import test from "node:test";
import assert from "node:assert/strict";
import {
  createMockOptionLayoutPlan,
  createOptionScreenModel,
  validateOptionLayoutPlan,
  validateOptionScreenModel,
} from "./optionLayoutPlan.ts";

const standard = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  viewportMode: null,
};

const groups = ["temperature", "size", "cup"];

test("standard options model allows two columns at regular width and one at compact width", () => {
  const regular = createOptionScreenModel(390, standard, groups);
  const compact = createOptionScreenModel(360, standard, groups);

  assert.equal(regular.screenId, "cafe.product-options");
  assert.deepEqual(regular.constraints.allowedColumns, [1, 2]);
  assert.equal(regular.constraints.defaultColumns, 2);
  assert.deepEqual(compact.constraints.allowedColumns, [1]);
  assert.equal(validateOptionScreenModel(regular)?.screenId, regular.screenId);
  assert.equal(validateOptionScreenModel(compact)?.screenId, compact.screenId);
});

test("accessibility constraints restrict two-column option plans", () => {
  const largeText = createOptionScreenModel(390, {
    ...standard,
    textSize: "large",
  }, groups);
  const largeButtons = createOptionScreenModel(390, {
    ...standard,
    buttonSize: "large",
  }, groups);

  assert.deepEqual(largeText.constraints.allowedColumns, [1]);
  assert.deepEqual(largeButtons.constraints.allowedColumns, [1]);
  assert.equal(validateOptionLayoutPlan(
    createMockOptionLayoutPlan(largeText, 2),
    largeText,
  ), null);
});

test("validated Mock plans can request one or two columns without changing option data", () => {
  const model = createOptionScreenModel(390, standard, groups);
  const one = validateOptionLayoutPlan(createMockOptionLayoutPlan(model, 1), model);
  const two = validateOptionLayoutPlan(createMockOptionLayoutPlan(model, 2), model);

  assert.equal(one?.columns, 1);
  assert.equal(two?.columns, 2);
});

test("plan validator rejects unsupported targets, operations, and protected data", () => {
  const model = createOptionScreenModel(390, standard, groups);
  const valid = createMockOptionLayoutPlan(model, 2);

  assert.equal(validateOptionLayoutPlan({
    ...valid,
    operations: [{ ...valid.operations[0], targetId: "options.price" }],
  }, model), null);
  assert.equal(validateOptionLayoutPlan({
    ...valid,
    operations: [...valid.operations, valid.operations[0]],
  }, model), null);
  assert.equal(validateOptionLayoutPlan({
    ...valid,
    cart: [{ quantity: 999 }],
  }, model), null);
});

test("model validator rejects altered structural and accessibility constraints", () => {
  const model = createOptionScreenModel(390, standard, groups);

  assert.equal(validateOptionScreenModel({
    ...model,
    screenId: "cafe.menu",
  }), null);
  assert.equal(validateOptionScreenModel({
    ...model,
    constraints: { ...model.constraints, allowedColumns: [1, 2, 3] },
  }), null);
  assert.equal(validateOptionScreenModel({
    ...model,
    groups: [{ ...model.groups[0], preserveSelection: false }, ...model.groups.slice(1)],
  }), null);
});

test("group inventory contains semantic identifiers only and deduplicates groups", () => {
  const model = createOptionScreenModel(390, standard, ["size", "cup", "size"]);

  assert.deepEqual(model.groups.map((group) => group.id), ["size", "cup"]);
  assert.equal(JSON.stringify(model).includes("Americano"), false);
  assert.equal(JSON.stringify(model).includes("4200"), false);
});
