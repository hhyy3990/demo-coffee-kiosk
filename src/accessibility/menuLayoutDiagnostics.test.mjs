import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearMenuLayoutDiagnosticHistory,
  loadMenuLayoutDiagnosticHistory,
  MENU_LAYOUT_DIAGNOSTICS_KEY,
  MENU_LAYOUT_DIAGNOSTICS_LIMIT,
  persistMenuLayoutDiagnostic,
  sanitizeMenuLayoutDiagnostic,
} from "./menuLayoutDiagnostics.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test("diagnostic storage allowlists scalar fields and excludes arbitrary payloads", () => {
  globalThis.window = { sessionStorage: new MemoryStorage() };
  const record = sanitizeMenuLayoutDiagnostic({
    phase: "response_received",
    source: "central",
    status: 200,
    localRequestId: "safe-id",
    token: "must-not-persist",
    qrProfile: { private: true },
    plan: { columns: 2 },
  }, { recordedAt: "2026-10-24T00:00:00.000Z", sessionId: "session", pageRunId: "run" });

  assert.equal(record.status, 200);
  assert.equal(record.localRequestId, "safe-id");
  assert.equal("token" in record, false);
  assert.equal("qrProfile" in record, false);
  assert.equal("plan" in record, false);
  delete globalThis.window;
});

test("diagnostics persist across reloads, cap at 50, and clear only the diagnostic key", () => {
  const store = new MemoryStorage();
  globalThis.window = { sessionStorage: store };
  for (let index = 0; index < 55; index += 1) {
    persistMenuLayoutDiagnostic({ phase: "model_created", viewportWidth: index });
  }

  const records = loadMenuLayoutDiagnosticHistory();
  assert.equal(records.length, MENU_LAYOUT_DIAGNOSTICS_LIMIT);
  assert.equal(records[0].viewportWidth, 5);
  assert.equal(JSON.parse(store.getItem(MENU_LAYOUT_DIAGNOSTICS_KEY)).length, 50);
  store.setItem("unrelated", "preserve");
  clearMenuLayoutDiagnosticHistory();
  assert.equal(loadMenuLayoutDiagnosticHistory().length, 0);
  assert.equal(store.getItem("unrelated"), "preserve");
  delete globalThis.window;
});

test("storage access failures do not interrupt diagnostic recording", () => {
  globalThis.window = { get sessionStorage() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => persistMenuLayoutDiagnostic({ phase: "request_started" }));
  assert.deepEqual(loadMenuLayoutDiagnosticHistory(), []);
  delete globalThis.window;
});
