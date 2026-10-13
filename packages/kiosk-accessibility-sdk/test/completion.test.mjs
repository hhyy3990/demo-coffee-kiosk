import test from "node:test";
import assert from "node:assert/strict";
import { createCompletionController, DEFAULT_COMPLETION_SECONDS } from "../src/completion.ts";

function fakeClock() {
  const original = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let now = 1_000;
  let id = 0;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay = 0) => {
    const timerId = ++id;
    timers.set(timerId, { fn, due: now + delay });
    return timerId;
  };
  globalThis.clearTimeout = (timerId) => timers.delete(timerId);
  return {
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
      await Promise.resolve();
      await Promise.resolve();
    },
    restore() {
      Date.now = original.now;
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
    },
  };
}

test("completion counts down 15 seconds, supports repeated extension, and returns once", async () => {
  const clock = fakeClock();
  let calls = 0;
  const controller = createCompletionController(() => {});
  try {
    assert.equal(DEFAULT_COMPLETION_SECONDS, 15);
    controller.begin(() => { calls += 1; });
    await clock.advance(10_000);
    assert.equal(controller.state.remainingSeconds, 5);
    assert.equal(controller.extend(), true);
    assert.equal(controller.state.remainingSeconds, 15);
    await clock.advance(5_000);
    assert.equal(controller.extend(), true);
    await clock.advance(14_999);
    assert.equal(calls, 0);
    await clock.advance(1);
    assert.equal(calls, 1);
    assert.deepEqual(controller.state, { active: false, returning: false, remainingSeconds: 0, error: false });
  } finally {
    controller.dispose();
    clock.restore();
  }
});

test("completion cancel, immediate finish, stale generations, and callback failure are safe", async () => {
  const clock = fakeClock();
  let calls = 0;
  const controller = createCompletionController(() => {});
  try {
    controller.begin(() => { calls += 1; });
    controller.cancel();
    await clock.advance(20_000);
    assert.equal(calls, 0);

    let resolveSlow;
    let slowCalls = 0;
    controller.begin(() => {
      slowCalls += 1;
      return new Promise((resolve) => { resolveSlow = resolve; });
    });
    const slowReturn = controller.finish();
    await controller.finish();
    assert.equal(slowCalls, 1);
    assert.equal(controller.state.returning, true);
    resolveSlow();
    await slowReturn;
    assert.equal(controller.state.active, false);

    controller.begin(() => { calls += 1; });
    await controller.finish();
    await clock.advance(20_000);
    assert.equal(calls, 1);

    controller.begin(() => { throw new Error("host reset failed"); });
    await clock.advance(15_000);
    assert.equal(controller.state.active, true);
    assert.equal(controller.state.error, true);
    controller.begin(() => { calls += 1; });
    await controller.finish();
    assert.equal(calls, 2);
  } finally {
    controller.dispose();
    clock.restore();
  }
});
