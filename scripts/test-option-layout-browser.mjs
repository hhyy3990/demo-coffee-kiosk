import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const debugPort = 49400 + (process.pid % 300);
const userData = await mkdtemp(join(tmpdir(), "democoffee-option-layout-"));
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });

let socket;
try {
  let target;
  for (let attempt = 0; attempt < 150; attempt += 1) {
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

  let nextId = 0;
  let aiPlanRequests = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.requestWillBeSent") {
      try {
        if (new URL(message.params.request.url).pathname === "/api/ai-layout/plan") {
          aiPlanRequests += 1;
        }
      } catch {}
    }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
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
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(50);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate(`({
      url: location.href,
      classes: [...(document.querySelector('.kiosk')?.classList ?? [])],
      diagnostics: (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .filter((event) => event.screenId === "cafe.product-options")
        .slice(-8),
      body: document.body.innerText.slice(0, 400)
    })`))}`);
  };
  const click = async (selector) => {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    assert.ok(clicked, `Missing clickable element: ${selector}`);
    await wait(100);
  };
  const clickText = async (selector, text) => {
    const clicked = await evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
      if (!element) return false;
      element.click();
      return true;
    })()`);
    assert.ok(clicked, `Missing ${selector} containing ${text}`);
    await wait(100);
  };
  const openOptions = async (width, mockColumns = null, extraQuery = "") => {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: width, screenHeight: 844,
    });
    const queryParams = new URLSearchParams();
    if (mockColumns) queryParams.set("mockOptionLayout", String(mockColumns));
    if (mockColumns || extraQuery) queryParams.set("menuLayoutDiagnostics", "1");
    for (const [key, value] of new URLSearchParams(extraQuery)) queryParams.set(key, value);
    const query = queryParams.size ? `?${queryParams}` : "";
    await send("Page.navigate", { url: `${appUrl}/${query}` });
    await waitFor("Boolean(document.querySelector('#start-store'))", "welcome screen");
    await click("#start-store");
    await waitFor("Boolean(document.querySelector('.product-grid .product-card'))", "menu");
    await click('.product-card[data-menu-index="0"] button');
    await waitFor(
      "Boolean(document.querySelector('[data-option-layout-screen=\"cafe.product-options\"]'))",
      "product options",
    );
    await wait(150);
  };
  const readLayout = () => evaluate(`(() => {
    const groups = [...document.querySelectorAll('.choice-pills[data-option-ai-group]')];
    return groups.map((group) => {
      const columns = getComputedStyle(group).gridTemplateColumns;
      return {
        group: group.dataset.optionAiGroup,
        marker: group.dataset.optionAiColumns ?? null,
        template: columns,
        count: columns.trim().split(/\\s+/).filter(Boolean).length,
        buttons: group.querySelectorAll('button').length,
        selected: group.querySelectorAll('button.selected').length,
      };
    });
  })()`);
  const readDiagnostics = () => evaluate(`(window.__demoCoffeeMenuLayoutDiagnostics ?? [])
    .filter((event) => event.screenId === "cafe.product-options")`);
  const assertGrid = (groups, expectedMarker, expectedCount) => {
    assert.equal(groups.length, 3, "Americano should keep its three option groups");
    for (const group of groups) {
      assert.equal(group.marker, expectedMarker);
      assert.equal(group.count, expectedCount, `${group.group} columns: ${group.template}`);
      assert.equal(group.buttons, 2, `${group.group} option inventory changed`);
      assert.equal(group.selected, 1, `${group.group} selected state missing`);
    }
  };

  await send("Runtime.enable");
  await send("Network.enable");

  for (const width of [360, 390]) {
    await openOptions(width);
    const baseline = await readLayout();
    assert.equal(baseline.length, 3);
    assert.ok(baseline.every((group) => group.marker === null));
    const originalTemplates = baseline.map((group) => group.template);

    await openOptions(width, 1);
    const oneColumn = await readLayout();
    assertGrid(oneColumn, "1", 1);
    const oneEvents = await readDiagnostics();
    assert.ok(oneEvents.some((event) => event.phase === "plan_validated"));
    assert.ok(oneEvents.some((event) => event.phase === "react_dom_committed" &&
      event.screenId === "cafe.product-options" && event.planState === "applied" &&
      event.computedColumnCount === 1));

    await openOptions(width, 2);
    const twoEvents = await readDiagnostics();
    if (width === 360) {
      const rejected = await readLayout();
      assert.ok(rejected.every((group) => group.marker === null));
      assert.deepEqual(rejected.map((group) => group.template), originalTemplates);
      assert.ok(twoEvents.some((event) => event.phase === "plan_rejected" &&
        event.reason === "columns_not_allowed"));
    } else {
      assertGrid(await readLayout(), "2", 2);
      assert.ok(twoEvents.some((event) => event.phase === "plan_validated" &&
        event.screenId === "cafe.product-options" && event.columns === 2));
    }
  }

  await openOptions(390, 2, "poc-profile=large-text-buttons");
  await waitFor(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some((event) =>
      event.screenId === "cafe.product-options" &&
      event.phase === "model_created" &&
      event.allowedColumns === "1")`,
    "large-text accessibility model",
  );
  const accessibleTwoColumn = await readLayout();
  assert.ok(accessibleTwoColumn.every((group) => group.marker === null));
  const accessibilityEvents = await readDiagnostics();
  assert.ok(accessibilityEvents.some((event) => event.phase === "model_created" &&
    event.allowedColumns === "1"));
  assert.ok(accessibilityEvents.some((event) => event.phase === "plan_rejected" &&
    event.reason === "columns_not_allowed"));

  await openOptions(390, 2);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 360, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 360, screenHeight: 844,
  });
  await waitFor(`!document.querySelector('.choice-pills[data-option-ai-columns="2"]')`,
    "two-column plan cancellation after viewport change");
  const cancelledLayout = await readLayout();
  assert.ok(cancelledLayout.every((group) => group.marker === null));
  const cancelledEvents = await readDiagnostics();
  assert.ok(cancelledEvents.some((event) => event.phase === "plan_cancelled" &&
    event.reason === "model_changed"));

  await openOptions(390, 2);
  await click(".back-button");
  await waitFor("Boolean(document.querySelector('.product-grid .product-card'))", "back to menu");
  await click('.product-card[data-menu-index="0"] button');
  await waitFor(
    "Boolean(document.querySelector('[data-option-layout-screen=\"cafe.product-options\"]'))",
    "reopened product options",
  );
  await clickText(".option-group:nth-of-type(2) button", "크게");
  const selectedLarge = await evaluate(
    'document.querySelector(".option-group:nth-of-type(2) button.selected")?.textContent?.includes("크게")',
  );
  assert.equal(selectedLarge, true, "size selection should remain host-owned and interactive");
  await click('[aria-label="수량 늘리기"]');
  const addText = await evaluate('document.querySelector("#item-add")?.textContent');
  assert.ok(addText?.includes("9,800원"), `Large size and quantity price should be preserved: ${addText}`);
  await click("#item-add");
  await waitFor("Boolean(document.querySelector('#menu-order-confirm'))", "menu after add-to-cart");
  await click("#menu-order-confirm");
  await waitFor("Boolean(document.querySelector('.cart-item'))", "cart");
  const cart = await evaluate(`({
    text: document.querySelector('.cart-item')?.textContent ?? '',
    quantity: document.querySelector('.cart-quantity strong')?.textContent ?? '',
  })`);
  assert.ok(cart.text.includes("아메리카노"));
  assert.ok(cart.text.includes("큰 사이즈"));
  assert.equal(cart.quantity, "2");
  assert.equal(aiPlanRequests, 0, "Mock option layouts must never call the central AI API");

  console.log(JSON.stringify({
    viewports: [360, 390],
    baselinePreserved: true,
    mockOneColumn: "applied at both viewports",
    mockTwoColumn: "rejected at 360px and applied at 390px",
    accessibility: "large-text/buttons profile rejects two columns",
    cancellation: "viewport change cancels the stale option plan",
    businessActions: "selection, +700 price, quantity, cart, and back verified",
    aiPlanRequests,
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGKILL"); } catch {}
  await rm(userData, { recursive: true, force: true });
}
