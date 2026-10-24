import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const envMockOnly = process.env.MENU_LAYOUT_ENV_MOCK_TEST === "1";
const debugPort = 49320 + (process.pid % 300);
const userData = await mkdtemp(join(tmpdir(), "democoffee-layout-diagnostics-"));
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });

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

  let nextId = 0;
  let aiLayoutRequests = 0;
  const diagnostics = [];
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.requestWillBeSent" &&
        new URL(message.params.request.url).pathname === "/api/ai-layout/plan") {
      aiLayoutRequests += 1;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args ?? [])
        .map((argument) => argument.value ?? argument.description ?? "").join(" ");
      if (text.includes("[menu-layout-diagnostic]")) diagnostics.push(text);
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
    throw new Error(`Timed out waiting for ${label}`);
  };
  const openMenu = async (query) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: 390, screenHeight: 844,
    });
    await send("Page.navigate", { url: `${appUrl}/${query}` });
    await waitFor("Boolean(document.querySelector('#start-store'))", "welcome screen");
    if (query.includes("mockCentralQrProfileForAiTest=1")) {
      await waitFor(
        "Boolean(document.querySelector('.profile-strip')) && document.querySelector('.kiosk')?.classList.contains('a11y-text-large')",
        "Mock central QR profile application",
      );
    }
    await evaluate("document.querySelector('#start-store').click()");
    await waitFor("Boolean(document.querySelector('.product-grid .product-card'))", "menu");
    await wait(200);
  };
  const readGrid = () => evaluate(`(() => {
    const grid = document.querySelector(".product-grid");
    const button = grid?.querySelector(".product-card > button");
    const image = grid?.querySelector(".product-art")?.getBoundingClientRect();
    const info = grid?.querySelector(".product-meta")?.getBoundingClientRect();
    const css = grid ? getComputedStyle(grid) : null;
    return {
      viewport: innerWidth,
      aiColumns: grid?.dataset.aiColumns ?? null,
      aiCardFlow: grid?.dataset.aiCardFlow ?? null,
      gridTemplateColumns: css?.gridTemplateColumns ?? null,
      computedColumnCount: css?.gridTemplateColumns.split(" ").filter(Boolean).length ?? 0,
      cardButtonDisplay: button ? getComputedStyle(button).display : null,
      imageInfoGapPx: image && info ? Math.round(info.left - image.right) : null
    };
  })()`);

  await send("Runtime.enable");
  await send("Network.enable");
  await openMenu("?");
  const noPlan = await readGrid();
  assert.equal(noPlan.viewport, 390);
  assert.equal(noPlan.aiColumns, null);
  assert.equal(noPlan.computedColumnCount, 2);
  const automaticSkip = await evaluate(
    "(window.__demoCoffeeMenuLayoutDiagnostics ?? []).filter(event => event.phase === 'auto_trigger_skipped').map(event => ({ reason: event.reason, featureFlagEnabled: event.featureFlagEnabled }))",
  );
  assert.ok(automaticSkip.length > 0, "Automatic trigger skip reason should be diagnosable");
  if (envMockOnly) {
    assert.ok(automaticSkip.some((event) =>
      event.reason === "central_qr_profile_not_active" && event.featureFlagEnabled === true,
    ));
  } else {
    assert.ok(automaticSkip.some((event) =>
      event.reason === "feature_flag_off" || event.reason === "central_qr_profile_not_active",
    ));
  }

  await openMenu(envMockOnly
    ? "?mockCentralQrProfileForAiTest=1"
    : "?mockCentralQrProfileForAiTest=1&mockAutoMenuLayout=1");
  await waitFor(
    'document.querySelector(".product-grid")?.dataset.aiCardFlow === "row"',
    "automatic QR-to-menu Mock plan",
  );
  const automaticMock = await readGrid();
  assert.equal(automaticMock.viewport, 390);
  assert.equal(automaticMock.aiColumns, "1");
  assert.equal(automaticMock.aiCardFlow, "row");
  assert.equal(automaticMock.computedColumnCount, 1);

  const autoPhases = await evaluate(
    "(window.__demoCoffeeMenuLayoutDiagnostics ?? []).map(event => event.phase)",
  );
  for (const phase of [
    "auto_trigger_eligible",
    "model_created",
    "model_contract_validated",
    "request_started",
    "plan_received",
    "plan_validated",
    "react_state_update_requested",
    "react_dom_committed",
  ]) assert.ok(autoPhases.includes(phase), `Missing automatic diagnostic phase: ${phase}`);
  const autoModeDetails = await evaluate(
    "(window.__demoCoffeeMenuLayoutDiagnostics ?? []).findLast(event => event.phase === 'auto_trigger_eligible')",
  );
  assert.ok(autoModeDetails);
  if (envMockOnly) {
    assert.equal(autoModeDetails.featureFlagEnabled, true);
    assert.equal(autoModeDetails.mockOnly, true);
    const modelValidation = await evaluate(
      "(window.__demoCoffeeMenuLayoutDiagnostics ?? []).findLast(event => event.phase === 'model_contract_validated')",
    );
    assert.equal(modelValidation?.valid, true);
  }

  await openMenu("?mockAiLayout=columns-2");
  await waitFor(
    'document.querySelector(".product-grid")?.dataset.aiColumns === "2"',
    "explicit two-column plan",
  );
  const appliedTwoColumns = await readGrid();
  assert.equal(appliedTwoColumns.viewport, 390);
  assert.equal(appliedTwoColumns.aiColumns, "2");
  assert.equal(appliedTwoColumns.computedColumnCount, 2);

  await openMenu("?mockAiLayout=menu-row");
  await waitFor(
    'document.querySelector(".product-grid")?.dataset.aiCardFlow === "row"',
    "one-column card-row plan",
  );
  const appliedOneColumn = await readGrid();
  assert.equal(appliedOneColumn.viewport, 390);
  assert.equal(appliedOneColumn.aiColumns, "1");
  assert.equal(appliedOneColumn.computedColumnCount, 1);
  assert.equal(appliedOneColumn.aiCardFlow, "row");
  assert.equal(appliedOneColumn.cardButtonDisplay, "grid");
  assert.ok(appliedOneColumn.imageInfoGapPx >= 8);

  await evaluate("document.querySelector('#menu-product-0').click()");
  await waitFor("Boolean(document.querySelector('#item-add'))", "options screen");
  await evaluate("document.querySelector('#item-add').click()");
  await waitFor(
    'Boolean(document.querySelector(".product-grid")) && !document.querySelector(".product-grid").dataset.aiColumns',
    "plan removal and default layout restoration",
  );
  const restored = await readGrid();
  assert.equal(restored.viewport, 390);
  assert.equal(restored.aiColumns, null);
  assert.equal(restored.aiCardFlow, null);
  assert.equal(restored.computedColumnCount, 2);
  assert.equal(aiLayoutRequests, 0, "Mock browser test must not call the relay");
  const diagnosticPhases = await evaluate(
    "(window.__demoCoffeeMenuLayoutDiagnostics ?? []).map(event => event.phase)",
  );
  assert.ok(diagnosticPhases.includes("plan_received"));
  assert.ok(diagnosticPhases.includes("plan_validated"));
  assert.ok(diagnosticPhases.includes("react_state_update_requested"));
  assert.ok(diagnosticPhases.includes("react_dom_committed"));

  console.log(JSON.stringify({
    noPlan,
    automaticMock,
    autoModeDetails,
    appliedTwoColumns,
    appliedOneColumn,
    restored,
    aiLayoutRequests,
    diagnosticEvents: diagnosticPhases,
    result: "PASS",
  }));
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  await new Promise((resolve) => {
    if (browser.exitCode !== null || browser.signalCode !== null) return resolve();
    browser.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
  await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
