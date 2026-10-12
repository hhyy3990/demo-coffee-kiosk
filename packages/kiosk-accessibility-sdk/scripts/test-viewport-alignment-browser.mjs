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
  const previousFailureCases = new Set([
    "min-height_320x844_true", "centered_320x844_true", "centered-min-height_320x844_true",
    "centered-long_320x844_true", "inner-scroll_320x844_true", "with-controls_320x844_true",
    "safe-centered_320x844_true", "min-height_360x667_true", "centered_360x667_false",
    "centered_360x667_true", "centered-min-height_360x667_true", "centered-long_360x667_true",
    "centered-long_390x844_true",
    "inner-scroll_390x844_true",
    "centered-long_1440x900_true", "inner-scroll_1440x900_true",
    "centered-long_1920x1080_true", "inner-scroll_1920x1080_true",
  ]);
  const reports = [];
  const scrollReturnExperiment = process.env.SCROLL_RETURN_EXPERIMENT;
  let scrollExperimentCompleted = false;

  for (const [width, height] of sizes) {
    const emulateMobile = width < 600 && process.env.SCROLL_RETURN_MOBILE !== "off";
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: emulateMobile, screenWidth: width, screenHeight: height,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: emulateMobile, maxTouchPoints: 1 });
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
      const failureKey = `${testCase.layout}_${width}x${height}_${testCase.large}`;
      const testId = `${testCase.layout}_${width}x${height}_large-${testCase.large}_viewport-${testCase.percent}`;
      if (process.env.ALIGNMENT_TEST_ID && process.env.ALIGNMENT_TEST_ID !== testId) continue;
      if (process.env.FAILURES_ONLY === "1" && !previousFailureCases.has(failureKey)) continue;
      const query = new URLSearchParams({
        layout: testCase.layout,
        percent: process.env.SCROLL_RETURN_VIEWPORT === "off" ? "none" : String(testCase.percent),
        large: String(testCase.large),
      });
      if (process.env.SCROLL_RETURN_ANCHOR === "none") {
        query.set("diagnostic", "overflow-anchor-none");
      }
      if (process.env.SCROLL_RETURN_POSITION === "static") {
        query.set("diagnostic", "position-static");
      }
      if (process.env.SCROLL_RETURN_GUIDANCE === "off") {
        query.set("diagnostic", "scroll-guidance-disabled");
      }
      if (process.env.SCROLL_RETURN_HINT === "keep") {
        query.set("diagnostic", "hint-removal-blocked");
      }
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
      if (scrollReturnExperiment === "none" || scrollReturnExperiment === "input") {
        await wait(1000);
        if (scrollReturnExperiment === "input") {
          const stageRect = result.top.stage;
          const x = Math.max(1, Math.min(width - 2, stageRect.left + stageRect.width / 2));
          const y = Math.max(1, Math.min(height - 2, stageRect.top + stageRect.height / 2));
          for (let attempt = 0; attempt < 8; attempt += 1) {
            await send("Input.dispatchTouchEvent", {
              type: "touchStart", touchPoints: [{ x, y, id: 1 }],
            });
            for (let step = 1; step <= 6; step += 1) {
              await send("Input.dispatchTouchEvent", {
                type: "touchMove", touchPoints: [{ x, y: Math.max(1, y - step * 42), id: 1 }],
              });
              await wait(20);
            }
            await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await wait(150);
          }
          await evaluate("window.waitForScrollQuiet()");
        }
        const timeline = await evaluate("window.captureScrollReturnTimeline()");
        reports.push({
          experiment: scrollReturnExperiment,
          viewport: `${width}x${height}`,
          layout: testCase.layout,
          large: testCase.large,
          percent: testCase.percent,
          fixture: result,
          timeline,
        });
        scrollExperimentCompleted = true;
        break;
      }
      const stage = result.top.stage;
      const inputX = Math.max(1, Math.min(width - 2, stage.left + stage.width / 2));
      const inputY = Math.max(1, Math.min(height - 2, stage.top + stage.height / 2));
      let previousScrollTop = -1;
      let stableScrollCount = 0;
      for (let scrollAttempt = 0; scrollAttempt < (width < 600 ? 8 : 18); scrollAttempt += 1) {
        if (width < 600) {
          await send("Input.dispatchTouchEvent", {
            type: "touchStart", touchPoints: [{ x: inputX, y: inputY, id: 1 }],
          });
          for (let step = 1; step <= 6; step += 1) {
            await send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: inputX, y: Math.max(1, inputY - step * 42), id: 1 }],
            });
            await wait(20);
          }
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel", x: inputX, y: inputY, deltaX: 0, deltaY: 700,
          });
        }
        await wait(150);
        const current = await evaluate("window.readLastAction()");
        if (current.scrollTop >= current.maxScroll - 1) break;
        stableScrollCount = current.scrollTop === previousScrollTop ? stableScrollCount + 1 : 0;
        previousScrollTop = current.scrollTop;
        if (stableScrollCount >= 3) break;
      }
      const scrollQuiet = await evaluate("window.waitForScrollQuiet()");
      const afterWheel = await evaluate("window.readLastAction()");
      const finalLast = await evaluate("window.readLastAction()");
      if (finalLast.hit) {
        const clickX = finalLast.rect.left + finalLast.rect.width / 2;
        const clickY = finalLast.rect.top + finalLast.rect.height / 2;
        if (width < 600) {
          await send("Input.dispatchTouchEvent", {
            type: "touchStart", touchPoints: [{ x: clickX, y: clickY, id: 1 }],
          });
          await wait(80);
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1,
          });
        }
      }
      const inputClick = await evaluate("Boolean(window.lastActionClicked)");
      let forcedDiagnostics = [];
      if (!finalLast.visible || !finalLast.hit || !inputClick) {
        forcedDiagnostics = await evaluate("window.forceMaximumScrollDiagnostic()");
      }
      let forcedMaximumClick = false;
      const forcedAtMax = forcedDiagnostics[0];
      if (forcedAtMax && forcedAtMax.immediateTop >= forcedAtMax.maxScroll - 1 &&
          forcedAtMax.visible && forcedAtMax.hit) {
        await evaluate("window.lastActionClicked = false");
        const clickX = forcedAtMax.rect.left + forcedAtMax.rect.width / 2;
        const clickY = forcedAtMax.rect.top + forcedAtMax.rect.height / 2;
        if (width < 600) {
          await send("Input.dispatchTouchEvent", {
            type: "touchStart", touchPoints: [{ x: clickX, y: clickY, id: 1 }],
          });
          await wait(80);
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1,
          });
        }
        forcedMaximumClick = await evaluate("Boolean(window.lastActionClicked)");
      }
      await evaluate("window.destroyFixtureSdk()");
      const forcedAfterDestroy = process.env.ALIGNMENT_TEST_ID
        ? await evaluate("window.forceMaximumScrollDiagnostic()")
        : [];
      result = {
        ...result,
        afterWheel,
        scrollQuiet,
        last: finalLast,
        lastActionClicked: inputClick,
        forcedDiagnostics,
        forcedMaximumClick,
        forcedAfterDestroy,
        restoredJustifyContent: await evaluate("getComputedStyle(document.querySelector('#stage')).justifyContent"),
      };
      reports.push(result);
    }
    if (scrollExperimentCompleted) break;
  }
  if (scrollExperimentCompleted) {
    console.log(JSON.stringify(reports[0], null, 2));
  } else {
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
  if ((!process.env.ALIGNMENT_TEST_ID && process.env.FAILURES_ONLY !== "1" && reports.length !== 103) ||
      (!process.env.ALIGNMENT_TEST_ID && process.env.FAILURES_ONLY !== "1" && requiredRegression.length !== 2) ||
      requiredRegression.some((item) =>
        !item.top.headingFullyVisible || !item.top.headingHit ||
        !item.last.visible || !item.last.hit || !item.lastActionClicked)) {
    throw new Error("The reproduced 1440x900 clipping case did not pass its post-fix browser regression.");
  }
  if (failures.length) {
    throw new Error(`${failures.length} of ${reports.length} last-action browser checks did not pass.`);
  }
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
