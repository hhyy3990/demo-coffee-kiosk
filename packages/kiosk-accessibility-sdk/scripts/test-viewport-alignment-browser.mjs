import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const port = 9750 + (process.pid % 100);
const profileDir = await mkdtemp(`${tmpdir()}/sdk-alignment-${process.pid}-`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore", detached: true });
let socket;

try {
  let page;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`))
        .json()).find((target) => target.type === "page");
      if (page) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error("Chromium failed to start.");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sizes = [[320, 844], [360, 667], [390, 844], [1080, 1920], [1440, 900], [1920, 1080]];
  const layouts = ["min-height", "centered", "centered-min-height", "centered-long",
    "dock-controls", "inner-scroll", "with-controls", "safe-centered"];
  const reports = [];

  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height,
    });
    const cases = layouts.flatMap((layout) => [
      { layout, large: false, percent: 80 },
      { layout, large: true, percent: 80 },
    ]);
    if (width === 1440 && height === 900) {
      for (const percent of [60, 70, 80]) {
        cases.push({ layout: "dock-controls", large: false, percent });
        cases.push({ layout: "dock-controls", large: true, percent });
      }
      cases.push({ layout: "centered-min-height", large: true, percent: 70 });
    }
    for (const testCase of cases) {
      const query = new URLSearchParams({
        layout: testCase.layout,
        percent: String(testCase.percent),
        large: String(testCase.large),
      });
      await send("Page.navigate", {
        url: `http://127.0.0.1:5000/packages/kiosk-accessibility-sdk/test/viewport-alignment-fixture.html?${query}`,
      });
      let result;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        result = await evaluate("window.fixtureReady || null");
        if (result) break;
        await wait(40);
      }
      if (!result) {
        const debug = await evaluate(`({
          readyState: document.readyState,
          heading: Boolean(document.querySelector("#first-heading")),
          content: Boolean(document.querySelector(".content")),
          stage: Boolean(document.querySelector("#stage")),
          scriptType: [...document.scripts].map((item) => item.type),
        })`);
        throw new Error(`Alignment fixture timed out: ${width}x${height}/${JSON.stringify(testCase)} ${JSON.stringify(debug)}`);
      }
      const stage = result.top.stage;
      const inputX = Math.max(1, Math.min(width - 2, stage.left + stage.width / 2));
      const inputY = Math.max(1, Math.min(height - 2, stage.top + stage.height / 2));
      for (let scrollAttempt = 0; scrollAttempt < 6; scrollAttempt += 1) {
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: inputX,
          y: inputY,
          deltaX: 0,
          deltaY: 12000,
        });
        await wait(70);
      }
      const afterWheel = await evaluate("window.readLastAction()");
      const finalLast = await evaluate("window.readLastAction()");
      if (finalLast.hit) {
        const clickX = finalLast.rect.left + finalLast.rect.width / 2;
        const clickY = finalLast.rect.top + finalLast.rect.height / 2;
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1,
        });
      }
      await evaluate("window.destroyFixtureSdk()");
      result = {
        ...result,
        afterWheel,
        last: finalLast,
        lastActionClicked: await evaluate("Boolean(window.lastActionClicked)"),
        restoredJustifyContent: await evaluate("getComputedStyle(document.querySelector('#stage')).justifyContent"),
      };
      reports.push(result);
    }
  }
  const failures = reports.filter((item) =>
    !item.applied || !item.last.visible || !item.last.hit || !item.lastActionClicked);
  const headingClips = reports.filter((item) => !item.top.headingFullyVisible || !item.top.headingHit);
  console.log(JSON.stringify({
    caseCount: reports.length,
    headingClipCount: headingClips.length,
    headingClips,
    lastItemFailures: failures,
    cases: reports,
  }, null, 2));
  const requiredRegression = reports.filter((item) =>
    item.layout === "centered-min-height" && item.viewport === "1440x900" && item.percent === 80);
  if (reports.length !== 103 || requiredRegression.length !== 2 ||
      requiredRegression.some((item) =>
        !item.top.headingFullyVisible || !item.top.headingHit ||
        !item.last.visible || !item.last.hit || !item.lastActionClicked)) {
    throw new Error("The reproduced 1440x900 clipping case did not pass its post-fix browser regression.");
  }
  if (failures.length) {
    throw new Error(`${failures.length} of ${reports.length} last-action browser checks did not pass.`);
  }
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  if (browser.exitCode === null && browser.signalCode === null) {
    await Promise.race([
      new Promise((resolve) => browser.once("exit", resolve)),
      wait(2000),
    ]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
