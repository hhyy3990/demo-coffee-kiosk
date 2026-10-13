import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const { createAccessibilitySdk, DEFAULT_ACCESSIBILITY_PROFILE } = sdk;

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
      ...DEFAULT_ACCESSIBILITY_PROFILE,
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
    HTMLElement: Object.getOwnPropertyDescriptor(globalThis, "HTMLElement"),
    SpeechSynthesisUtterance: Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance"),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const timerCallbacks = new Map();
  const clearedTimers = new Set();
  const scheduledDelays = new Map();
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
    requestAnimationFrame(callback) { return globalThis.setTimeout(() => callback(0), 0); },
    cancelAnimationFrame(id) { globalThis.clearTimeout(id); },
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
        const listeners = new Map();
        return {
        className: "",
        textContent: "",
        dataset: {},
        style: {},
        classList: makeClassList(),
        children: [],
        setAttribute() {},
        addEventListener(type, callback) {
          const callbacks = listeners.get(type) ?? [];
          callbacks.push(callback);
          listeners.set(type, callbacks);
        },
        dispatch(type, event = {}) {
          for (const callback of listeners.get(type) ?? []) callback(event);
        },
        append(...nodes) { this.children.push(...nodes); },
        remove() {
          const index = children.indexOf(this);
          if (index >= 0) children.splice(index, 1);
        },
        getBoundingClientRect: () => ({ top: 0, bottom: 80, left: 0, width: 220, height: 80 }),
      };
    },
  };
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = ++timerId;
    timerCallbacks.set(id, callback);
    scheduledDelays.set(id, delay);
    return id;
  };
  globalThis.clearTimeout = (id) => clearedTimers.add(id);
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: class HTMLElement {} });
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
    scheduledDelays,
    get speechCancels() { return speechCancels; },
    get speechUtterances() { return speechUtterances; },
    restore() {
      sdkInstance.destroy();
      globalThis.setTimeout = originals.setTimeout;
      globalThis.clearTimeout = originals.clearTimeout;
      for (const key of ["window", "document", "HTMLElement", "SpeechSynthesisUtterance"]) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
        else delete globalThis[key];
      }
    },
  };
}

test("guide step updates keep one timer for value edits and restart only at business-step boundaries", () => {
  const h = createSessionHarness();
  try {
    h.sdk.applyProfile({ ...DEFAULT_ACCESSIBILITY_PROFILE, smartGuide: true });
    const guide = (stepId, text, delaySeconds = 10) => h.sdk.setGuideState({
      stepId,
      enabled: true,
      paused: false,
      delaySeconds,
      message: { title: "안내", text, actionId: "continue" },
    });

    guide("cafe.options", "온도와 크기를 선택해 주세요.");
    const optionsTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.scheduledDelays.get(optionsTimer), 10_000);

    guide("cafe.options", "차갑게, 큰 사이즈가 선택되어 있어요.");
    assert.equal(h.clearedTimers.has(optionsTimer), false);
    assert.equal([...h.timerCallbacks.keys()].at(-1), optionsTimer);

    guide("cafe.cart", "주문을 확인한 뒤 결제로 이동해요.", 15);
    const cartTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.notEqual(cartTimer, optionsTimer);
    assert.equal(h.clearedTimers.has(optionsTimer), true);
    assert.equal(h.scheduledDelays.get(cartTimer), 15_000);

    guide("cafe.cart.confirm-modal", "주문 내용을 확인해 주세요.", 15);
    const modalTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.clearedTimers.has(cartTimer), true);
    guide("cafe.cart", "주문 화면으로 돌아왔어요.", 15);
    const returnedCartTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.clearedTimers.has(modalTimer), true);

    guide("cafe.payment", "결제 방법을 선택해 주세요.", 20);
    const paymentTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.clearedTimers.has(returnedCartTimer), true);
    assert.equal(h.scheduledDelays.get(paymentTimer), 20_000);

    h.sdk.setGuideState({
      stepId: "cafe.payment",
      enabled: false,
      paused: false,
      delaySeconds: 20,
      message: { title: "안내", text: "사용 안 함", actionId: "continue" },
    });
    assert.equal(h.clearedTimers.has(paymentTimer), true);
    assert.equal(h.children.length, 0);
    const timerCount = h.timerCallbacks.size;
    h.sdk.setGuideState({
      stepId: "cafe.payment.no-copy",
      enabled: true,
      paused: false,
      delaySeconds: 20,
      message: null,
    });
    assert.equal(h.timerCallbacks.size, timerCount);
  } finally {
    h.restore();
  }
});

test("a committed screen change cancels the old guide before a replacement step arrives", () => {
  const h = createSessionHarness();
  try {
    h.sdk.applyProfile({ ...DEFAULT_ACCESSIBILITY_PROFILE, smartGuide: true });
    h.sdk.setGuideState({
      stepId: "cafe.options",
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "옵션", text: "옵션을 골라 주세요.", actionId: "continue" },
    });
    const oldTimer = [...h.timerCallbacks.keys()].at(-1);
    h.timerCallbacks.get(oldTimer)?.();
    assert.equal(h.children.length, 1);
    const oldDismissTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.sdk.notifyScreenChange("cafe.cart"), true);
    assert.equal(h.clearedTimers.has(oldDismissTimer), true);
    assert.equal(h.children.length, 0);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), false);
    assert.equal(h.sdk.notifyScreenChange("cafe.cart"), false);
    h.sdk.setGuideState({
      stepId: "cafe.cart",
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "주문 확인", text: "주문을 확인해 주세요.", actionId: "continue" },
    });
    assert.notEqual([...h.timerCallbacks.keys()].at(-1), oldTimer);
    const newIdleTimer = [...h.timerCallbacks.keys()].at(-1);
    h.timerCallbacks.get(newIdleTimer)?.();
    h.timerCallbacks.get(oldDismissTimer)?.();
    assert.equal(h.children.length, 1);
  } finally {
    h.restore();
  }
});

test("closing the Smart Guide directly removes it and cancels its auto-dismiss timer", () => {
  const h = createSessionHarness();
  try {
    h.sdk.applyProfile({ ...DEFAULT_ACCESSIBILITY_PROFILE, smartGuide: true });
    h.sdk.setGuideState({
      stepId: "fixture.confirm",
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "확인", text: "계속 버튼을 눌러 주세요.", actionId: "continue" },
    });
    h.timerCallbacks.get([...h.timerCallbacks.keys()].at(-1))?.();
    const dismissTimer = [...h.timerCallbacks.keys()].at(-1);
    const close = h.children[0].children.find((element) => element.className === "a11y-guide-close");
    close.dispatch("click", { stopPropagation() {} });
    assert.equal(h.children.length, 0);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), false);
    assert.equal(h.clearedTimers.has(dismissTimer), true);
  } finally {
    h.restore();
  }
});

test("a visible Smart Guide closes after 10 seconds, clears emphasis, and does not reappear for same-step edits", () => {
  const h = createSessionHarness();
  try {
    h.sdk.applyProfile({ ...DEFAULT_ACCESSIBILITY_PROFILE, smartGuide: true });
    h.sdk.setGuideState({
      stepId: "fixture.confirm",
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "확인", text: "계속 버튼을 눌러 주세요.", actionId: "continue" },
    });
    const idleTimer = [...h.timerCallbacks.keys()].at(-1);
    h.timerCallbacks.get(idleTimer)?.();
    assert.equal(h.children.length, 1);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), true);
    const dismissTimer = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.scheduledDelays.get(dismissTimer), 10_000);

    h.timerCallbacks.get(dismissTimer)?.();
    assert.equal(h.children.length, 0);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), false);
    const timersAfterDismiss = h.timerCallbacks.size;
    h.sdk.setGuideState({
      stepId: "fixture.confirm",
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "확인", text: "수량이 바뀌었습니다.", actionId: "continue" },
    });
    assert.equal(h.timerCallbacks.size, timersAfterDismiss);
    assert.equal(h.children.length, 0);
  } finally {
    h.restore();
  }
});

test("endSession clears profile classes, pending guide and speech, and leaves host data untouched", () => {
  const h = createSessionHarness();
  const hostOrder = Object.freeze({ applicationId: "host-owned", step: "review" });
  try {
    h.sdk.applyProfile({
      ...sdk.DEFAULT_ACCESSIBILITY_PROFILE,
      textSize: "extraLarge", buttonSize: "large", contrast: "high",
      bottomControls: true, smartGuide: true, voiceGuidance: true,
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
    const dismissTimerId = [...h.timerCallbacks.keys()].at(-1);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), true);
    h.sdk.speak("Session speech");
    const utterancesBeforeEnd = h.speechUtterances;
    assert.ok(h.root.classList.contains("a11y-text-extra"));
    assert.ok(h.root.classList.contains("a11y-high-contrast"));

    h.sdk.endSession();
    assert.equal(h.clearedTimers.has(dismissTimerId), true);
    assert.deepEqual(h.sdk.profile, sdk.DEFAULT_ACCESSIBILITY_PROFILE);
    assert.equal(h.children.length, 0);
    assert.equal(h.target.classList.contains("a11y-guide-emphasis"), false);
    assert.ok(h.speechCancels >= 2);
    assert.equal(h.speechUtterances, utterancesBeforeEnd);
    assert.deepEqual(hostOrder, { applicationId: "host-owned", step: "review" });

    const staleGuideTimer = h.timerCallbacks.get(pendingTimerId);
    staleGuideTimer?.();
    h.timerCallbacks.get(dismissTimerId)?.();
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
    h.sdk.applyProfile({ ...sdk.DEFAULT_ACCESSIBILITY_PROFILE, textSize: "extraLarge", smartGuide: true });
    h.sdk.setGuideState({
      enabled: true,
      paused: false,
      delaySeconds: 10,
      message: { title: "Next", text: "Continue.", actionId: "continue" },
    });
    const timerBeforeEnd = [...h.timerCallbacks.keys()].at(-1);
    const staleGuard = h.sdk.createSessionGuard();
    const pending = client.resolve("session-token-12345678901234567890");
    h.sdk.endSession();
    assert.ok(h.clearedTimers.has(timerBeforeEnd));
    h.sdk.endSession();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(staleGuard(), false);

    h.sdk.applyProfile({ ...sdk.DEFAULT_ACCESSIBILITY_PROFILE, textSize: "large", buttonSize: "large", smartGuide: true });
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
