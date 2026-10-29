import test from "node:test";
import assert from "node:assert/strict";
import { resolveQrAutoLayoutExecutionMode } from "./qrAutoLayoutGate.ts";

const defaults = {
  development: true,
  autoEnabled: false,
  mockEnabled: false,
  openAiEnabled: false,
};

test("QR automatic layout is disabled unless Development auto is explicitly enabled", () => {
  assert.equal(resolveQrAutoLayoutExecutionMode(defaults), null);
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: true, development: false, openAiEnabled: true,
  }), null);
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: false, openAiEnabled: true,
  }), null);
});

test("QR automatic layout requires exactly one mutually exclusive plan mode", () => {
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: true,
  }), null);
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: true, mockEnabled: true, openAiEnabled: true,
  }), null);
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: true, mockEnabled: true,
  }), "mock");
  assert.equal(resolveQrAutoLayoutExecutionMode({
    ...defaults, autoEnabled: true, openAiEnabled: true,
  }), "openai");
});
