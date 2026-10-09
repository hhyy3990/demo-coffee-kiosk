import test from "node:test";
import assert from "node:assert/strict";
import { inspectKioskLayout } from "../src/diagnostics.ts";

function element({
  id = "",
  left = 0,
  top = 0,
  width = 100,
  height = 50,
  clientWidth = width,
  clientHeight = height,
  scrollWidth = clientWidth,
  scrollHeight = clientHeight,
  overflowX = "visible",
  overflowY = "visible",
} = {}) {
  return {
    id,
    dataset: {},
    isConnected: true,
    disabled: false,
    clientWidth,
    clientHeight,
    scrollWidth,
    scrollHeight,
    overflowX,
    overflowY,
    ownerDocument: null,
    parentElement: null,
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    }),
    contains: () => false,
  };
}

test("layout audit reports clipping, page overflow, offscreen and obscured targets without reading text", () => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  try {
    globalThis.window = {
      innerWidth: 320,
      innerHeight: 600,
      getComputedStyle: (target) => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        overflowX: target.overflowX,
        overflowY: target.overflowY,
        getPropertyValue: () => "none",
      }),
    };
    globalThis.document = {
      documentElement: { clientWidth: 320, clientHeight: 600 },
    };

    const root = element({ width: 320, height: 600, scrollWidth: 336 });
    const text = element({
      width: 50,
      height: 30,
      clientWidth: 50,
      scrollWidth: 84,
      overflowX: "hidden",
    });
    const smallAction = element({
      left: 300,
      top: 100,
      width: 30,
      height: 36,
    });
    const primaryAction = element({
      left: 80,
      top: 560,
      width: 90,
      height: 60,
    });
    const bottomControls = element({ left: 0, top: 580, width: 320, height: 40 });
    const contained = new Set([text, smallAction, primaryAction, bottomControls]);
    root.contains = (child) => child === root || contained.has(child);
    text.isConnected = smallAction.isConnected = primaryAction.isConnected = true;
    const adapter = {
      getSnapshot: () => ({ screenId: "cafe.cart" }),
      getActions: () => [
        { id: "cart.quantity", name: "수량 변경", element: smallAction, enabled: true },
        { id: "cart.pay", name: "결제하기", element: primaryAction, enabled: true, primary: true },
      ],
      getTextTargets: () => [{ id: "cafe.cart.title", element: text }],
      getLayoutRegions: () => ({ bottomControls: [bottomControls], scrollArea: null }),
    };

    const issues = inspectKioskLayout(root, adapter);
    const types = new Set(issues.map((issue) => issue.issueType));
    assert.ok(types.has("horizontal-overflow"));
    assert.ok(types.has("text-clipped"));
    assert.ok(types.has("small-touch-target"));
    assert.ok(types.has("action-offscreen"));
    assert.ok(types.has("bottom-control-obscures-action"));
    assert.ok(issues.every((issue) => issue.screenId === "cafe.cart"));
    assert.ok(issues.every((issue) => !("text" in issue.measurements)));
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
