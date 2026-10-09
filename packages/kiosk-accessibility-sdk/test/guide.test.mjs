import test from "node:test";
import assert from "node:assert/strict";
import { createIdleTimer, smartGuideDelayMs } from "../src/guide.ts";

test("guide delays retain the central profile choices", () => {
  assert.equal(smartGuideDelayMs(10), 10_000);
  assert.equal(smartGuideDelayMs(15), 15_000);
  assert.equal(smartGuideDelayMs(20), 20_000);
});

test("idle timer reset cancels the prior timer and dispose prevents later callbacks", () => {
  let nextId = 0;
  const pending = new Map();
  const driver = {
    set(callback, delayMs) {
      const id = ++nextId;
      pending.set(id, { callback, delayMs });
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
  };
  let idleCalls = 0;
  const timer = createIdleTimer(() => { idleCalls += 1; }, driver);

  timer.reset(10_000);
  timer.reset(15_000);
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0].delayMs, 15_000);
  const [handle, entry] = [...pending.entries()][0];
  pending.delete(handle);
  entry.callback();
  assert.equal(idleCalls, 1);
  timer.reset(20_000);
  timer.dispose();
  assert.equal(pending.size, 0);
  assert.equal(idleCalls, 1);
});
