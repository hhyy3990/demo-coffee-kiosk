import test from "node:test";
import assert from "node:assert/strict";
import {
  createMenuPlanGate,
  createMenuScreenModel,
  createMockMenuLayoutPlan,
  validateMenuLayoutPlan,
} from "./accessibility/menuLayoutPlan.ts";

const profile = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  viewportMode: null,
};

function context(width = 390, currentProfile = profile) {
  return createMenuScreenModel(width, currentProfile);
}

test("safe menu model contains only explicit layout structure and constraints", () => {
  const model = context();
  assert.equal(model.hostId, "democoffee");
  assert.equal(model.screenId, "cafe.menu");
  assert.equal(model.viewportClass, "regular");
  assert.equal(model.constraints.minimumTouchTargetPx, 44);
  assert.deepEqual(model.allowedOperations, ["setGroupFlow", "setChildBasis"]);
  assert.equal(JSON.stringify(model).includes("Americano"), false);
  assert.equal(JSON.stringify(model).includes("price"), true); // semantic role only
  assert.equal(JSON.stringify(model).includes("quantity"), false);
  assert.equal(JSON.stringify(model).includes("token"), false);
});

test("mock plan is validated and projects only bounded layout properties", () => {
  const model = context();
  const plan = createMockMenuLayoutPlan(model);
  assert.deepEqual(validateMenuLayoutPlan(plan, model), {
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: "regular",
    gapPx: 12,
    imageBasisPercent: 25,
    imageMinimumPx: 76,
  });
});

test("rejects a plan with an unknown field or operation target", () => {
  const model = context();
  const plan = createMockMenuLayoutPlan(model);
  assert.equal(validateMenuLayoutPlan({ ...plan, html: "<div>" }, model), null);
  const badTarget = structuredClone(plan);
  badTarget.operations[0].targetId = "menu.payment";
  assert.equal(validateMenuLayoutPlan(badTarget, model), null);
});

test("rejects stale screen structure, viewport, and QR constraints", () => {
  const plan = createMockMenuLayoutPlan(context());
  assert.equal(validateMenuLayoutPlan(plan, context(360)), null);
  assert.equal(validateMenuLayoutPlan(plan, context(390, {
    ...profile,
    textSize: "extraLarge",
    viewportMode: { mode: "bottom", heightPercent: 70 },
  })), null);
  assert.equal(validateMenuLayoutPlan({
    ...plan,
    structureHash: "stale",
  }, context()), null);
});

test("rejects operations that can hide content or exceed safe bounds", () => {
  const model = context();
  const wrongDirection = createMockMenuLayoutPlan(model);
  wrongDirection.operations[0].direction = "column";
  assert.equal(validateMenuLayoutPlan(wrongDirection, model), null);

  const unsafeGap = createMockMenuLayoutPlan(model);
  unsafeGap.operations[0].gapPx = 100;
  assert.equal(validateMenuLayoutPlan(unsafeGap, model), null);

  const oversizedImage = createMockMenuLayoutPlan(model);
  oversizedImage.operations[1].basisPercent = 90;
  assert.equal(validateMenuLayoutPlan(oversizedImage, model), null);

  const removedOperation = createMockMenuLayoutPlan(model);
  removedOperation.operations.pop();
  assert.equal(validateMenuLayoutPlan(removedOperation, model), null);
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
