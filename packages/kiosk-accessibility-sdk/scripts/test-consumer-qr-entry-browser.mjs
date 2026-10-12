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
  const fontCorrectionCases = [];
  const viewports = [
    [320, 844], [360, 667], [390, 844],
    [1080, 1920], [1440, 900], [1920, 1080],
  ];
  const structures = ["document", "inner", "fixed-controls", "stage-root", "stage-root-fixed"];
  const modes = [null, 60, 70, 80];

  for (const [width, height] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
      screenWidth: width, screenHeight: height,
    });
    for (const structure of structures) {
      for (const percent of structure.startsWith("stage-root") ? modes.slice(1) : modes) {
        const query = new URLSearchParams({ structure, percent: percent ?? "none" });
        const hostTailCase = width === 360 && height === 667 &&
          structure === "stage-root-fixed" && percent === 60;
        if (hostTailCase) query.set("hostTail", "1");
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
          const controlsTop = structure === "fixed-controls" || structure === "stage-root-fixed"
            ? await evaluate("document.querySelector('.bottom-controls').getBoundingClientRect().top")
            : height;
          if (!started.qrViewportApplied || started.qrViewportMode?.heightPercent !== percent ||
              Math.abs(started.viewportRect.height - expectedViewportHeight) > 2 ||
              started.viewportRect.bottom > Math.min(dockTop, controlsTop) + 1) {
            throw new Error(`v3 QR viewport was not automatically applied or excluded fixed UI: ${
              JSON.stringify({ width, height, structure, percent, started, expectedViewportHeight, controlsTop })
            }`);
          }
        if (!started.dockBottomMode) {
          throw new Error(`QR dock did not follow profile viewportMode: ${JSON.stringify({ width, height, structure, percent, started })}`);
        }
      } else if (started.dockBottomMode || started.dockContentHeight) {
        throw new Error(`QR dock did not return to standard mode for null viewportMode: ${JSON.stringify(started)}`);
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
        if (percent === null && structure === "inner") {
          const transitions = await evaluate(
            `window.qrConsumerTest.verifyScreenTransitions(${width === 320})`,
          );
          if (!transitions.pass) {
            throw new Error(`Consumer screen-change reset/preservation failed: ${JSON.stringify({ width, transitions })}`);
          }
        }
        if (percent !== null && structure === "inner") {
          const transitions = await evaluate("window.qrConsumerTest.verifyScreenTransitions(false)");
          if (!transitions.pass) {
            throw new Error(`Bottom viewport screen-change failed: ${JSON.stringify({ width, height, percent, transitions })}`);
          }
        }
        if (width === 390 && structure === "fixed-controls" && percent === 70) {
          const transitions = await evaluate("window.qrConsumerTest.verifyScreenTransitions(false)");
          if (!transitions.pass) {
            throw new Error(`QR viewport screen-change transition failed: ${JSON.stringify(transitions)}`);
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
        const isTailReproduction = hostTailCase;
        if ((!isTailReproduction && (!atEnd.lastVisible || !atEnd.lastHit)) || !atEnd.fixedControlsVisible ||
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
          if (atEnd.dockScrollSpacerHeight > 1) {
            throw new Error(`The bottom viewport overlaps the SDK dock spacer: ${JSON.stringify({ width, height, structure, percent, spacer: atEnd.dockScrollSpacerHeight, viewport: atEnd.viewportRect })}`);
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
        if (width === 320 && structure === "inner" && percent === null) {
          const sessionReset = await evaluate("window.qrConsumerTest.verifySessionScreenReset()");
          if (!sessionReset.pass) {
            throw new Error(`Screen notification after endSession failed: ${JSON.stringify(sessionReset)}`);
          }
        }

        const dockPosition = atEnd.dockRect.top;
        cases.push({
          viewport: `${width}x${height}`, structure, percent: percent ?? "none",
          documentScrollRange: atEnd.documentRange, ownerScrollRange: atEnd.ownerRange,
          dockTop: dockPosition, dockHeight: atEnd.dockRect.height,
          dockScrollSpacerHeight: atEnd.dockScrollSpacerHeight,
          dockScrollSpacerContent: atEnd.dockScrollSpacerContent,
          scrollAreaHasDockClass: atEnd.scrollAreaHasDockClass,
          scrollAreaHasViewportClass: atEnd.scrollAreaHasViewportClass,
          hostTail: atEnd.hostTail, hostNoticeRect: atEnd.hostNoticeRect,
          contentHeight: atEnd.rootHeight, lastVisible: atEnd.lastVisible,
          lastClicked: clicked === 1, hintAtStart: atStart.hintVisible, overlays, touchScroll,
        });
      }
    }
  }

  for (const mode of ["fit", "14fit", "16fit", "fail", "none"]) {
    await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${baseUrl}/qr-entry.html?structure=inner&percent=none&fontCorrection=${mode}` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate("Boolean(window.qrConsumerTest)")) break;
      await wait(50);
    }
    const result = await evaluate("window.qrConsumerTest.get()");
    const correction = result.supportingCorrections[0];
    fontCorrectionCases.push({
      mode,
      fontSizeBefore: correction?.fontSizeBefore ?? result.supportingFont,
      fontSizeAfter: correction?.fontSizeAfter ?? result.supportingFont,
      outcome: correction?.outcome ?? "not-registered",
      diagnosticTypes: result.diagnostics.map((issue) => issue.issueType),
    });
    if (mode === "fit" && (!correction || correction.outcome !== "applied" ||
      correction.fontSizeBefore !== 24 || correction.fontSizeAfter !== 22.8 || result.supportingFont !== "22.8px" ||
      result.menuActionFont === result.supportingFont)) {
      throw new Error(`5% supporting-copy correction failed: ${JSON.stringify(result)}`);
    }
    const expectedCorrection = mode === "14fit"
      ? { before: 14, after: 13.3 }
      : mode === "16fit" ? { before: 16, after: 14.4 } : null;
    if (expectedCorrection && (!correction || correction.outcome !== "applied" ||
      correction.fontSizeBefore !== expectedCorrection.before ||
      correction.fontSizeAfter !== expectedCorrection.after ||
      result.supportingFont !== `${expectedCorrection.after}px`)) {
      throw new Error(`Small-font correction ${mode} failed: ${JSON.stringify(result)}`);
    }
    if (mode === "fail" && (!correction || correction.outcome !== "failed" ||
      result.supportingFont !== "24px" ||
      correction.attempts?.length !== 2 ||
      correction.attempts[0]?.reductionPercent !== 5 ||
      correction.attempts[1]?.reductionPercent !== 10 ||
      !result.diagnostics.some((issue) => issue.semanticId === "consumer.supporting-copy" &&
        issue.issueType === "text-clipped" && issue.severity === "error" && issue.viewport.width === 320))) {
      throw new Error(`10% correction failure was not restored and diagnosed: ${JSON.stringify(result)}`);
    }
    if (mode === "none" && result.supportingCorrections.length !== 0) {
      throw new Error(`Non-opted-in copy was modified: ${JSON.stringify(result)}`);
    }
    if (mode === "fit") {
      const restored = await evaluate("window.qrConsumerTest.restoreCorrectionProfile()");
      if (restored.fontSize !== "16px" || restored.inlineFontSize || restored.inlineLineHeight) {
        throw new Error(`Supporting-copy profile did not restore host styles: ${JSON.stringify(restored)}`);
      }
    }
    if (expectedCorrection) {
      const attempt = correction.attempts?.at(-1);
      const expectedPercent = mode === "14fit" ? 5 : 10;
      if (attempt?.reductionPercent !== expectedPercent) {
        throw new Error(`Expected ${expectedPercent}% attempt for ${mode}: ${JSON.stringify(correction)}`);
      }
    }
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${baseUrl}/qr-entry.html?structure=fixed-controls&percent=none&fontCorrection=none` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate("Boolean(window.qrConsumerTest)")) break;
    await wait(50);
  }
  const parentOverlap = await evaluate("window.qrConsumerTest.diagnoseOverlap('parent')");
  const dockOverlap = await evaluate("window.qrConsumerTest.diagnoseOverlap('dock')");
  const buttonOverlap = await evaluate("window.qrConsumerTest.diagnoseOverlap('button')");
  if (parentOverlap.some((issue) => issue.issueType === "text-obscured") ||
    dockOverlap.some((issue) => issue.issueType === "text-obscured") ||
    !buttonOverlap.some((issue) => issue.issueType === "text-obscured" &&
      issue.relatedSemanticId === "footer.action.0" && issue.measurements.overlapWidth > 0 &&
      issue.measurements.overlapHeight > 0)) {
    throw new Error(`Fixed-button/dock diagnostic distinction failed: ${
      JSON.stringify({ parentOverlap, dockOverlap, buttonOverlap })
    }`);
  }
  const twoRegisteredCopies = await evaluate("window.qrConsumerTest.testMultipleCopy(2)");
  if (twoRegisteredCopies.fonts[0] !== "12.6px" || twoRegisteredCopies.fonts[1] !== "12.6px" ||
    twoRegisteredCopies.corrections.length !== 2 ||
    twoRegisteredCopies.corrections.some((result) => result.outcome !== "applied")) {
    throw new Error(`Both registered fixed-area notices were not corrected: ${JSON.stringify(twoRegisteredCopies)}`);
  }
  const oneRegisteredCopy = await evaluate("window.qrConsumerTest.testMultipleCopy(1)");
  if (oneRegisteredCopy.fonts[0] !== "12.6px" || oneRegisteredCopy.fonts[1] !== "14px" ||
    !oneRegisteredCopy.corrections.some((result) => result.targetId === "consumer.fixed-copy.1") ||
    oneRegisteredCopy.corrections.some((result) => result.targetId === "consumer.fixed-copy.2")) {
    throw new Error(`Registration scope for fixed-area notices failed: ${JSON.stringify(oneRegisteredCopy)}`);
  }
  const sessionRestore = await evaluate("window.qrConsumerTest.verifyCorrectionSessionRestore()");
  if (sessionRestore.before !== "12.6px" ||
    sessionRestore.after.some((result) => result.font !== "9.33333px" ||
      result.inlineFont !== "9.33333px" || result.inlineLineHeight !== "1")) {
    throw new Error(`endSession did not restore host copy styles: ${JSON.stringify(sessionRestore)}`);
  }

  const stageRootStructures = structures.filter((structure) => structure.startsWith("stage-root")).length;
  const expectedCases = viewports.length * (structures.length * modes.length - stageRootStructures);
  if (cases.length !== expectedCases) {
    throw new Error(`Expected ${expectedCases} consumer browser cases, got ${cases.length}.`);
  }
  console.log(JSON.stringify({
    installedPackageCssBrowserCases: cases.length,
    fontCorrectionCases,
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
