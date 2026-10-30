import assert from "node:assert/strict";
import test from "node:test";
import {
  claimQrProductionEvent,
  createQrProductionEventId,
  isQrProductionEventId,
} from "./qrProductionEvent.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("Production QR event IDs are fresh UUIDs and reject malformed values", () => {
  const first = createQrProductionEventId();
  const second = createQrProductionEventId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
  assert.equal(isQrProductionEventId(first), true);
  assert.equal(isQrProductionEventId("not-a-uuid"), false);
  assert.equal(isQrProductionEventId("00000000-0000-0000-0000-000000000000"), false);
});

test("the same event can only be claimed once, including after a page reload", () => {
  const storage = memoryStorage();
  const eventId = createQrProductionEventId();
  assert.equal(claimQrProductionEvent(eventId, storage), true);
  // A reloaded page uses the same tab's sessionStorage.
  assert.equal(claimQrProductionEvent(eventId, storage), false);
  assert.equal(claimQrProductionEvent(createQrProductionEventId(), storage), true);
});

test("Production event claiming fails closed when session storage is unavailable", () => {
  const unavailable = {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => {},
  };
  assert.equal(claimQrProductionEvent(createQrProductionEventId(), unavailable), false);
});
