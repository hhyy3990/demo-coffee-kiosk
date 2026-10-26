import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromiumPath = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const debugPort = 49600 + (process.pid % 200);
const userData = await mkdtemp(join(tmpdir(), "democoffee-universal-layout-"));
const browser = spawn(chromiumPath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });
const browserExit = new Promise((resolve) => browser.once("exit", resolve));

let socket;
try {
  let target;
  for (let i = 0; i < 120; i += 1) {
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
  let id = 0;
  let centralPlanRequests = 0;
  let localMockRequests = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.requestWillBeSent") {
      const path = new URL(message.params.request.url).pathname;
      if (path === "/api/ai-layout/plan") centralPlanRequests += 1;
      if (path === "/api/dev/universal-layout/mock-plan") localMockRequests += 1;
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate, label) => {
    for (let i = 0; i < 120; i += 1) {
      if (await evaluate(predicate)) return;
      await wait(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await send("Runtime.enable");
  await send("Network.enable");

  const openMenu = async (width, columns, extra = "") => {
    try { await evaluate("sessionStorage.clear()"); } catch {}
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: width, screenHeight: 844,
    });
    const query = `?menuLayoutDiagnostics=1&universalLayoutMock=1&universalMockColumns=${columns}${extra}`;
    await send("Page.navigate", { url: `${appUrl}/${query}` });
    await until("Boolean(document.querySelector('#start-store'))", "welcome screen");
    await evaluate("document.querySelector('#start-store').click()");
    await until("Boolean(document.querySelector('.product-grid .product-card'))", "menu screen");
    return query;
  };
  const grid = () => evaluate(`(() => {
    const el = document.querySelector('.product-grid');
    const css = el ? getComputedStyle(el) : null;
    return {
      viewport: innerWidth,
      universalColumns: el?.dataset.universalColumns ?? null,
      menuV2Columns: el?.dataset.aiColumns ?? null,
      computedColumns: css?.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length ?? 0,
      gridTemplateColumns: css?.gridTemplateColumns ?? null
    };
  })()`);
  const waitForApplied = async (columns, source = "universal_mock") => {
    try {
      await until(
        `document.querySelector('.product-grid')?.dataset.universalColumns === '${columns}'`,
        `${columns}-column plan`,
      );
    } catch (error) {
      console.error("apply diagnostics", JSON.stringify(await evaluate(`({
        stage: document.querySelector('[data-stage]')?.getAttribute('data-stage') ?? null,
        grid: document.querySelector('.product-grid')?.outerHTML.slice(0, 250) ?? null,
        events: window.__demoCoffeeMenuLayoutDiagnostics ?? []
      })`), null, 2));
      throw error;
    }
    const result = await grid();
    assert.equal(result.computedColumns, columns);
    const committed = await evaluate(
      `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'react_dom_committed' && e.source === '${source}' && e.universalColumns === '${columns}' && e.computedColumnCount === ${columns})`,
    );
    assert.equal(committed, true, "React/CSS commit diagnostic");
    return result;
  };
  const waitForRejected = async () => {
    await until(
      `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_rejected' && e.source === 'universal_mock' && e.reason === 'DISALLOWED_COLUMN_COUNT')`,
      "policy rejection",
    );
    const result = await grid();
    assert.equal(result.universalColumns, null);
    return result;
  };

  await openMenu(390, 1);
  const regularOne = await waitForApplied(1);
  await openMenu(390, 2);
  const regularTwo = await waitForApplied(2);
  await openMenu(360, 1);
  const compactOne = await waitForApplied(1);
  await openMenu(360, 2);
  const compactRejected = await waitForRejected();
  await openMenu(390, 2, "&mockCentralQrProfileForAiTest=large");
  const accessibilityRejected = await waitForRejected();

  await openMenu(390, 2);
  await waitForApplied(2);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 360, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 360, screenHeight: 844,
  });
  await until(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_cancelled' && e.source === 'universal_mock' && e.reason === 'screen_profile_or_viewport_changed')`,
    "stale plan cancellation on viewport change",
  );
  await until(
    `document.querySelector('.product-grid')?.dataset.universalColumns == null`,
    "stale Universal layout removed",
  );
  const viewportCancelled = await grid();
  assert.equal(viewportCancelled.computedColumns, 1);

  try { await evaluate("sessionStorage.clear()"); } catch {}
  await send("Page.navigate", {
    url: `${appUrl}/?menuLayoutDiagnostics=1&universalLayoutRelay=1&mockCentralQrProfileForAiTest=standard&mockAiLayout=columns-2`,
  });
  await until("Boolean(document.querySelector('#start-store'))", "central-mode welcome screen");
  await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/api/dev/universal-layout/plan') return nativeFetch(input, init);
      const request = JSON.parse(init.body);
      return nativeFetch('/api/dev/universal-layout/mock-plan', {
        ...init,
        body: JSON.stringify({ ...request, columns: 1 }),
      });
    };
  })()`);
  await evaluate("document.querySelector('#start-store').click()");
  await waitForApplied(1, "central");
  const centralModeSource = await evaluate(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_validated' && e.source === 'central' && e.columns === 1)`,
  );
  assert.equal(centralModeSource, true, "React central relay mode applied the locally substituted plan");
  assert.equal((await grid()).menuV2Columns, null, "menu.v2 mock cannot override Universal relay mode");

  await openMenu(390, 2);
  await waitForApplied(2);
  await evaluate("document.querySelector('#menu-product-0').click()");
  await until("Boolean(document.querySelector('#item-add'))", "options screen");
  assert.equal(await evaluate("document.querySelector('.product-grid') === null"), true,
    "leaving the menu removes its Universal layout target");
  const screenCancelled = await evaluate(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_cancelled' && e.source === 'universal_mock' && e.reason === 'screen_profile_or_viewport_changed')`,
  );
  assert.equal(screenCancelled, true, "screen change cancels the prior plan");
  await evaluate(`Array.from(document.querySelectorAll('.pill-option')).find(b => b.textContent.includes('+700'))?.click()`);
  await evaluate(`document.querySelector('[aria-label="수량 늘리기"]').click()`);
  await evaluate("document.querySelector('#item-add').click()");
  await until("Boolean(document.querySelector('#menu-order-confirm'))", "menu after add");
  await evaluate("document.querySelector('#menu-order-confirm').click()");
  await until("Boolean(document.querySelector('#cart-pay'))", "cart screen");
  const cartVerified = await evaluate(
    `document.body.innerText.includes('큰 사이즈') && document.body.innerText.includes('9,800원')`,
  );
  assert.equal(cartVerified, true, "size, quantity, and price remain host-owned");
  assert.equal(centralPlanRequests, 0, "no existing menu.v2 relay requests");
  assert.ok(localMockRequests >= 6, "Development local Mock route exercised");
  console.log(JSON.stringify({
    regularOne, regularTwo, compactOne, compactRejected, accessibilityRejected,
    viewportCancelled, centralModeSource, screenCancelled, cartVerified,
    localMockRequests, centralPlanRequests,
  }, null, 2));
} finally {
  socket?.close();
  try { process.kill(-browser.pid, "SIGTERM"); } catch {}
  await Promise.race([
    browserExit,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
