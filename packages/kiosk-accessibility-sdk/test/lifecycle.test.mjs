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

function createSessionHarness() {
  const originals = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    SpeechSynthesisUtterance: Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance"),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timerCallbacks = new Map();
  const clearedTimers = new Set();
  let timerId = 0;
  let speechCancels = 0;
  let speechUtterances = 0;
  const speech = { cancel() { speechCancels += 1; }, speak() { speechUtterances += 1; } };
  const windowStub = {
    PointerEvent: class PointerEvent {},
    innerHeight: 800,
    innerWidth: 1000,
    speechSynthesis: speech,
    addEventListener() {},
    removeEventListener() {},
  };
  const makeClassList = () => {
    const classes = new Set();
    return {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
    };
  };
  const target = {
    isConnected: true,
    classList: makeClassList(),
    getBoundingClientRect: () => ({ top: 200, bottom: 240, left: 200, width: 180, height: 40 }),
  };
  const children = [];
  const rootClasses = makeClassList();
  const root = {
    classList: rootClasses,
    addEventListener() {},
    removeEventListener() {},
    contains: (element) => element === target,
    append: (element) => children.push(element),
  };
  const documentStub = {
    createElement() {
      return {
        className: "",
        textContent: "",
        style: {},
        classList: makeClassList(),
        children: [],
        setAttribute() {},
        addEventListener() {},
        append(...nodes) { this.children.push(...nodes); },
        remove() {
          const index = children.indexOf(this);
          if (index >= 0) children.splice(index, 1);
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 80, left: 0, width: 220, height: 80 }),
      };
    },
  };
  globalThis.setTimeout = (callback) => {
    const id = ++timerId;
    timerCallbacks.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => clearedTimers.add(id);
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class SpeechSynthesisUtterance { constructor(text) { this.text = text; } },
  });
  const sdkInstance = sdk.createAccessibilitySdk({
    root,
    adapter: {
      getSnapshot: () => ({ screenId: "test.confirm", state: {} }),
      getActions: () => [{ id: "continue", name: "Continue", element: target, enabled: true, primary: true }],
      getTextTargets: () => [],
      getLayoutRegions: () => ({ bottomControls: [], scrollArea: null }),
    },
  });
  return {
    sdk: sdkInstance,
    root,
    target,
    children,
    timerCallbacks,
    clearedTimers,
    get speechCancels() { return speechCancels; },
    get speechUtterances() { return speechUtterances; },
    restore() {
      sdkInstance.destroy();
      globalThis.setTimeout = originals.setTimeout;
      globalThis.clearTimeout = originals.clearTimeout;
      for (const key of ["window", "document", "SpeechSynthesisUtterance"]) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
        else delete globalThis[key];
      }
    },
  };
}

test("endSession clears profile classes, pending guide and speech, and leaves host data untouched", () => {
  const h = createSessionHarness();
  const hostOrder = Object.freeze({ applicationId: "host-owned", step: "review" });
  try {
    h.sdk.applyProfile({
      textSize: "extraLarge", buttonSize: "large", contrast: "high",
      simplifiedLayout: true, bottomControls: true, smartGuide: true, voiceGuidance: true,
    });
    h.sdk.setGuideState({
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "Next", text: "Continue with the highlighted button.", actionId: "continue" },
    });
    const pendingTimerId = [...h.timerCallbacks.keys()].at(-1);
    h.timerCallbacks.get(pendingTimerId)?.();
    assert.equal(h.children.length, 1);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), true);
    h.sdk.speak("Session speech");
    const utterancesBeforeEnd = h.speechUtterances;
    assert.ok(h.root.classList.contains("a11y-text-extra"));
    assert.ok(h.root.classList.contains("a11y-high-contrast"));

    h.sdk.endSession();
    assert.deepEqual(h.sdk.profile, sdk.DEFAULT_ACCESSIBILITY_PROFILE);
    assert.equal(h.children.length, 0);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), false);
    assert.ok(h.speechCancels >= 2);
    assert.equal(h.speechUtterances, utterancesBeforeEnd);
    assert.deepEqual(hostOrder, { applicationId: "host-owned", step: "review" });

    const staleGuideTimer = h.timerCallbacks.get(pendingTimerId);
    staleGuideTimer?.();
    assert.equal(h.children.length, 0);
  } finally {
    h.restore();
  }
});

test("endSession is repeatable, cancels host-registered QR work and allows a fresh guarded profile", async () => {
  const h = createSessionHarness();
  const client = sdk.createQrProfileClient({
    fetcher: (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const unregister = h.sdk.registerSessionCleanup(() => client.cancel());
  try {
    h.sdk.applyProfile({ textSize: "extraLarge", smartGuide: true });
    h.sdk.setGuideState({
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "Next", text: "Continue.", actionId: "continue" },
    });
    const timerBeforeEnd = [...h.timerCallbacks.keys()].at(-1);
    const staleGuard = h.sdk.createSessionGuard();
    const pending = client.resolve("session-token");
    h.sdk.endSession();
    assert.ok(h.clearedTimers.has(timerBeforeEnd));
    h.sdk.endSession();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(staleGuard(), false);

    h.sdk.applyProfile({ textSize: "large", buttonSize: "large", smartGuide: true });
    const nextSessionGuard = h.sdk.createSessionGuard();
    assert.equal(nextSessionGuard(), true);
    assert.equal(h.sdk.profile.textSize, "large");
    assert.ok(h.root.classList.contains("a11y-controls-large"));
    h.sdk.setGuideState({
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "Next", text: "Continue.", actionId: "continue" },
    });
    const nextGuideTimer = [...h.timerCallbacks.keys()].at(-1);
    h.timerCallbacks.get(nextGuideTimer)?.();
    assert.equal(h.children.length, 1);
  } finally {
    unregister();
    h.restore();
  }
});
