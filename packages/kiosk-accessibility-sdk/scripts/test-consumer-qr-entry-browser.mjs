import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const consumerRoot = process.env.KIOSK_SDK_CONSUMER_ROOT;
if (!consumerRoot) throw new Error("KIOSK_SDK_CONSUMER_ROOT is required.");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const port = 48200 + (process.pid % 800);
const debugPort = port + 800;
const baseUrl = `http://127.0.0.1:${port}`;
const userData = await mkdtemp(join(tmpdir(), "sdk-consumer-chromium-"));
const vite = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/.bin/vite"),
  "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", "build",
], { cwd: consumerRoot, stdio: "ignore" });
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userData}`,
  "about:blank",
], { stdio: "ignore", detached: true });

let socket;
let browserGroup = browser.pid;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { ready = true; break; }
    } catch {}
    if (vite.exitCode !== null) throw new Error(`Vite preview exited with ${vite.exitCode}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Independent consumer preview did not start.");

  let target;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((entry) => entry.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target) throw new Error("Chromium did not start for independent consumer verification.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cases = [];
  const viewports = [[320, 844], [360, 667], [390, 844], [1080, 1920]];
  const structures = ["document", "inner", "fixed-controls"];
  const modes = [null, 60, 70, 80];

  for (const [width, height] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
      screenWidth: width, screenHeight: height,
    });
    for (const structure of structures) {
      for (const percent of modes) {
        const query = new URLSearchParams({ structure, percent: percent ?? "none" });
        await send("Page.navigate", { url: `${baseUrl}/qr-entry.html?${query}` });
        let loaded = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          loaded = await evaluate("Boolean(window.qrConsumerTest)");
          if (loaded) break;
          await wait(50);
        }
        if (!loaded) throw new Error(`Consumer QR fixture did not load: ${width}x${height}/${structure}/${percent}`);
        const started = await evaluate("window.qrConsumerTest.get()");
        if (!started.dockFixed || !started.rootActive || !started.restoredAfterDisable ||
          started.qrButtonHeight < 44 || started.horizontalOverflow) {
          throw new Error(`Consumer dock/lifecycle failed: ${JSON.stringify({ width, height, structure, percent, started })}`);
        }
        if (percent !== null) {
          const expectedViewportHeight = Math.floor((height - started.viewportInset) * percent / 100);
          const dockTop = started.dockRect.top;
          const controlsTop = structure === "fixed-controls"
            ? await evaluate("document.querySelector('.bottom-controls').getBoundingClientRect().top")
            : height;
          if (!started.qrViewportApplied || started.qrViewportMode?.heightPercent !== percent ||
              Math.abs(started.viewportRect.height - expectedViewportHeight) > 2 ||
              started.viewportRect.bottom > Math.min(dockTop, controlsTop) + 1) {
            throw new Error(`v3 QR viewport was not automatically applied or excluded fixed UI: ${
              JSON.stringify({ width, height, structure, percent, started, expectedViewportHeight, controlsTop })
            }`);
          }
        }
        if (started.guidanceEnabled && (!started.hintVisible || started.noSafeSpace || !started.hintAvoidsDockAndControls ||
          started.hintPointerEvents !== "none")) {
          throw new Error(`Consumer guidance did not fit around dock/controls: ${JSON.stringify({ width, height, structure, percent, started })}`);
        }
        await evaluate("window.qrConsumerTest.clickQr()");
        if (width === 320 && structure === "inner" && percent === 60) {
          const replacement = await evaluate("window.qrConsumerTest.verifyQrProfileReplacement()");
          if (!replacement.pass) {
            throw new Error(`QR viewport replacement/session reset failed: ${JSON.stringify(replacement)}`);
          }
        }

        const ownerPoint = await evaluate(`(() => {
          const owner = document.body.classList.contains("document-host")
            ? (document.body.dataset.qrScrollOwner === "inner"
              ? document.querySelector(".content")
              : document.documentElement.scrollHeight > document.documentElement.clientHeight
              ? document.scrollingElement : document.body)
            : document.querySelector(".content");
          const rect = owner.getBoundingClientRect();
          return { x: Math.min(innerWidth - 4, rect.left + rect.width / 2),
            y: Math.max(4, Math.min(innerHeight - 4, rect.top + rect.height / 2)) };
        })()`);
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: ownerPoint.x, y: ownerPoint.y, deltaX: 0, deltaY: 12000,
        });
        await wait(100);

        let touchScroll = null;
        if (width === 320 && structure === "inner" && percent === 70) {
          await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
          await evaluate(`(() => {
            const owner = document.querySelector(".content");
            owner.scrollTop = 0;
          })()`);
          await send("Input.dispatchTouchEvent", {
            type: "touchStart", touchPoints: [{ x: ownerPoint.x, y: Math.min(height - 180, ownerPoint.y + 100), id: 1 }],
          });
          await send("Input.dispatchTouchEvent", {
            type: "touchMove", touchPoints: [{ x: ownerPoint.x, y: Math.max(8, ownerPoint.y - 140), id: 1 }],
          });
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await wait(150);
          touchScroll = await evaluate("document.querySelector('.content').scrollTop");
          await send("Emulation.setTouchEmulationEnabled", { enabled: false });
        }
        await evaluate(`(() => {
          const owner = document.body.classList.contains("document-host")
            ? (document.body.dataset.qrScrollOwner === "inner"
              ? document.querySelector(".content")
              : document.documentElement.scrollHeight > document.documentElement.clientHeight
              ? document.scrollingElement : document.body)
            : document.querySelector(".content");
          owner.scrollTop = owner.scrollHeight;
        })()`);
        await wait(100);
        const atEnd = await evaluate("window.qrConsumerTest.get()");
        const qrClicks = await evaluate("window.qrConsumerTest.get().qrClicks");
        if (!atEnd.lastVisible || !atEnd.lastHit || !atEnd.fixedControlsVisible ||
          atEnd.horizontalOverflow || qrClicks !== 1 || atEnd.lastMenuClicks !== 0 ||
          atEnd.hintVisible || atEnd.noSafeSpace ||
          atEnd.ownerRange <= 0 ||
          (structure === "document" && percent === null
            ? (atEnd.ownerTag === "HTML" ? atEnd.documentRange !== atEnd.ownerRange : atEnd.documentRange !== 0)
            : atEnd.documentRange !== 0)) {
          throw new Error(`Consumer scroll/hit-test failed: ${JSON.stringify({ width, height, structure, percent, atEnd, qrClicks })}`);
        }
        if (percent !== null) {
          const expectedHeight = Math.floor((height - atEnd.viewportInset) * percent / 100);
          if (Math.abs(atEnd.viewportRect.height - expectedHeight) > 3) {
            throw new Error(`Consumer bottom viewport height differs from the API: ${JSON.stringify({ width, height, structure, percent, expectedHeight, actual: atEnd.viewportRect.height, inset: atEnd.viewportInset })}`);
          }
        }
        if (touchScroll !== null && touchScroll <= 0) {
          throw new Error("Mobile touch did not move the independent consumer's scroll owner.");
        }
        const lastPoint = await evaluate(`(() => {
          const r = document.querySelector("#last-menu").getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: lastPoint.x, y: lastPoint.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: lastPoint.x, y: lastPoint.y, button: "left", clickCount: 1 });
        const clicked = await evaluate("window.qrConsumerTest.get().lastMenuClicks");
        if (clicked !== 1) throw new Error(`Final menu item was not clicked: ${width}x${height}/${structure}/${percent}`);
        await evaluate(`(() => {
          const owner = document.body.classList.contains("document-host")
            ? (document.body.dataset.qrScrollOwner === "inner" ? document.querySelector(".content")
              : document.documentElement.scrollHeight > document.documentElement.clientHeight
                ? document.scrollingElement : document.body)
            : document.querySelector(".content");
          owner.scrollTop = 0;
        })()`);
        await wait(120);
        const atStart = await evaluate("window.qrConsumerTest.get()");
        if (atStart.guidanceEnabled && (!atStart.hintVisible || atStart.noSafeSpace)) {
          throw new Error(`Consumer hint did not return at scroll start: ${JSON.stringify({ width, height, structure, percent, atStart })}`);
        }
        let overlays = null;
        if (width === 320 && structure === "inner" && percent === 60) {
          overlays = {
            modal: await evaluate("window.qrConsumerTest.guidanceOverlayPriority('modal')"),
            guide: await evaluate("window.qrConsumerTest.guidanceOverlayPriority('guide')"),
          };
          if (!overlays.modal.hidden || !overlays.modal.returns ||
            !overlays.guide.hidden || !overlays.guide.returns) {
            throw new Error(`Consumer modal/guide priority failed: ${JSON.stringify(overlays)}`);
          }
          overlays.dockless = await evaluate("window.qrConsumerTest.verifyDockless()");
          if (!overlays.dockless.visible || overlays.dockless.noSafeSpace ||
            !overlays.dockless.qrDockAbsent || !overlays.dockless.controlsStillReachable) {
            throw new Error(`Consumer without QR dock failed: ${JSON.stringify(overlays.dockless)}`);
          }
        }

        const dockPosition = atEnd.dockRect.top;
        cases.push({
          viewport: `${width}x${height}`, structure, percent: percent ?? "none",
          documentScrollRange: atEnd.documentRange, ownerScrollRange: atEnd.ownerRange,
          dockTop: dockPosition, dockHeight: atEnd.dockRect.height,
          contentHeight: atEnd.rootHeight, lastVisible: atEnd.lastVisible,
          lastClicked: clicked === 1, hintAtStart: atStart.hintVisible, overlays, touchScroll,
        });
      }
    }
  }

  if (cases.length !== 48) throw new Error(`Expected 48 consumer browser cases, got ${cases.length}.`);
  console.log(JSON.stringify({
    installedPackageCssBrowserCases: cases.length,
    cases,
    result: "PASS",
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  try { if (browserGroup) process.kill(-browserGroup, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  vite.kill("SIGTERM");
  await Promise.all([browser, vite].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  })));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
