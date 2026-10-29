import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const chromiumPath = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const debugPort = 51000 + (process.pid % 1000);
const userData = await mkdtemp(join(tmpdir(), "democoffee-qr-gate-off-"));
const browser = spawn(chromiumPath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });
const browserExit = new Promise((resolve) => browser.once("exit", resolve));
let socket;

try {
  let target;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((entry) => entry.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(target, "Chromium did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let requestId = 0;
  let qrRequests = 0;
  let openAiRequests = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Fetch.requestPaused") {
      void (async () => {
        qrRequests += 1;
        const profile = {
          schemaVersion: 5,
          updatedAt: "2026-10-30T00:00:00.000Z",
          preferences: {
            textSize: "large", buttonSize: "large", contrast: "high",
            easyLanguage: true, viewportMode: { mode: "bottom", heightPercent: 70 },
            smartGuide: true, voiceGuidance: false, guideDelaySeconds: 15,
            language: "ko", stepByStepGuidance: false,
            conciseGuidance: false, slowGuidance: false, scrollGuidance: true,
          },
        };
        await send("Fetch.fulfillRequest", {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(profile)).toString("base64"),
        });
      })().catch((error) => console.error("Fake QR fulfillment failed", error));
      return;
    }
    if (message.method === "Network.requestWillBeSent" &&
        new URL(message.params.request.url).pathname ===
          "/api/dev/universal-layout/v2/openai-plan") {
      openAiRequests += 1;
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(predicate)) return;
      await wait(50);
    }
    throw new Error(`Timed out: ${label}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*"] });
  await send("Fetch.enable", { patterns: [
    { urlPattern: "*/api/qr-profile*", requestStage: "Request" },
  ] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await send("Page.navigate", { url: `${appUrl}/?menuLayoutDiagnostics=1` });
  await until("Boolean(document.querySelector('#start-store'))", "DemoCoffee start screen");
  await evaluate("document.querySelector('[data-a11y-qr-entry-dock] button').click()");
  await until("Boolean(document.querySelector('.qr-manual-toggle'))", "QR dialog");
  await evaluate("document.querySelector('.qr-manual-toggle').click()");
  await until("Boolean(document.querySelector('#profile-token'))", "manual token input");
  await evaluate(`(() => {
    const input = document.querySelector('#profile-token');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '0123456789abcdefghij');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.qr-manual-form button[type="submit"]').click();
  })()`);
  await until(
    `!document.querySelector('.qr-modal') &&
      document.querySelector('.kiosk')?.classList.contains('a11y-bottom-viewport-enabled')`,
    "fake v5 profile applied",
  );
  assert.equal(qrRequests, 1);
  await evaluate("document.querySelector('#start-store').click()");
  await until("Boolean(document.querySelector('.product-grid'))", "menu screen");
  await wait(500);
  assert.equal(openAiRequests, 0, "default-off gates send no OpenAI relay request");
  assert.equal(
    await evaluate(`(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(event =>
      event.source === 'universal_v2_qr_auto' && event.phase === 'request_started')`),
    false,
  );
  console.log(JSON.stringify({ qrRequests, openAiRequests, gateDefaultOff: true }));
} finally {
  socket?.close();
  try { process.kill(-browser.pid, "SIGTERM"); } catch {}
  await Promise.race([
    browserExit,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
