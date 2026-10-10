import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const { createAccessibilitySdk } = sdk;

test("profile application and SDK disposal only change SDK-owned root classes", () => {
  const priorWindow = globalThis.window;
  try {
    globalThis.window = {
      PointerEvent: class PointerEvent {},
      addEventListener() {},
      removeEventListener() {},
    };

    const classes = new Set(["kiosk", "host-theme", "a11y-text-large"]);
    const root = {
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
          return Boolean(force);
        },
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const businessState = Object.freeze({
      screenId: "cafe.cart",
      state: Object.freeze({ cartItemCount: 1, total: 4200 }),
    });
    const sdk = createAccessibilitySdk({
      root,
      adapter: {
        getSnapshot: () => businessState,
        getActions: () => [],
        getTextTargets: () => [],
        getLayoutRegions: () => ({ bottomControls: [], scrollArea: null }),
      },
    });

    sdk.applyProfile({
      textSize: "extraLarge",
      buttonSize: "large",
      contrast: "high",
      bottomControls: true,
    });
    assert.ok(classes.has("a11y-text-extra"));
    assert.ok(classes.has("a11y-controls-large"));
    assert.ok(classes.has("a11y-high-contrast"));
    assert.ok(classes.has("a11y-bottom-controls"));
    assert.equal(sdk.profile.textSize, "extraLarge");
    assert.deepEqual(businessState.state, { cartItemCount: 1, total: 4200 });

    sdk.destroy();
    assert.ok(classes.has("kiosk"));
    assert.ok(classes.has("host-theme"));
    assert.ok(classes.has("a11y-text-large"));
    assert.ok(!classes.has("a11y-text-extra"));
    assert.ok(!classes.has("a11y-controls-large"));
    assert.ok(!classes.has("a11y-high-contrast"));
    assert.ok(!classes.has("a11y-bottom-controls"));
    assert.deepEqual(businessState.state, { cartItemCount: 1, total: 4200 });
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});
