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
  const pointerClick = async (selector) => {
    const point = await evaluate(`(async () => {
      const initialTarget = document.querySelector(${JSON.stringify(selector)});
      if (!initialTarget) return null;
      const owner = initialTarget.closest('[data-a11y-slot="scroll-content"]');
      if (owner && owner.scrollHeight > owner.clientHeight) {
        const targetRect = initialTarget.getBoundingClientRect();
        const ownerRect = owner.getBoundingClientRect();
        owner.scrollTop += targetRect.top + targetRect.height / 2 -
          (ownerRect.top + owner.clientHeight / 2);
      } else {
        initialTarget.scrollIntoView({ block: "center", behavior: "auto" });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === target || target.contains(hit),
        visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight };
    })()`);
    if (!point?.hit || !point.visible) throw new Error(`Real pointer hit-test failed for ${selector}: ${JSON.stringify(point)}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
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
        if (started.guidanceEnabled && (!started.hintVisible ||
          started.hintPointerEvents !== "none" || !started.hintPassesDockClick)) {
          throw new Error(`Consumer guidance was hidden or blocked a dock click: ${JSON.stringify({ width, height, structure, percent, started })}`);
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
        const setScrollProgress = async (ratio) => evaluate(`(() => {
          const owner = document.body.classList.contains("document-host")
            ? (document.body.dataset.qrScrollOwner === "inner"
              ? document.querySelector(".content")
              : document.scrollingElement)
            : document.querySelector(".content");
          owner.scrollTop = (owner.scrollHeight - owner.clientHeight) * ${ratio};
          return owner.scrollTop;
        })()`);
        let hintDrift = [];
        if (started.guidanceEnabled) {
          await setScrollProgress(0.5);
          await wait(120);
          const atMidScroll = await evaluate("window.qrConsumerTest.get()");
          await setScrollProgress(0.85);
          await wait(120);
          const nearScrollEnd = await evaluate("window.qrConsumerTest.get()");
          const scrollHintSamples = [started, atMidScroll, nearScrollEnd];
          if (scrollHintSamples.some((state) => !state.hintVisible || !state.hintRect)) {
            throw new Error(`Scroll hint disappeared before the end of content: ${
              JSON.stringify(scrollHintSamples.map(({ hintVisible, hintRect, ownerRange, ownerScrollTop }) =>
                ({ hintVisible, hintRect, ownerRange, ownerScrollTop })))
            }`);
          }
          hintDrift = scrollHintSamples.slice(1).map((state) => ({
            x: Math.abs(state.hintRect.left - started.hintRect.left),
            y: Math.abs(state.hintRect.top - started.hintRect.top),
          }));
          if (
            hintDrift.some(({ x, y }) => x > 1 || y > 1) ||
            !atMidScroll.hintPassesDockClick || !nearScrollEnd.hintPassesDockClick) {
            throw new Error(`Scroll hint moved or conflicted while scrolling: ${
              JSON.stringify({ started: started.hintRect, atMidScroll: atMidScroll.hintRect,
                nearScrollEnd: nearScrollEnd.hintRect, hintDrift })
            }`);
          }
        }
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
        if (atStart.guidanceEnabled && (!atStart.hintVisible ||
            atStart.hintPointerEvents !== "none" || !atStart.hintPassesDockClick)) {
          throw new Error(`Consumer hint did not return at scroll start: ${JSON.stringify({ width, height, structure, percent, atStart })}`);
        }
        let overlays = null;
        if (width === 320 && structure === "inner" && percent === 60) {
          overlays = {
            modal: await evaluate("window.qrConsumerTest.guidanceOverlayPriority('modal')"),
            guide: await evaluate("window.qrConsumerTest.guidanceOverlayPriority('guide')"),
          };
          if (overlays.modal.hidden || !overlays.modal.modalOwnsScroll || !overlays.modal.returns ||
            overlays.guide.hidden || !overlays.guide.returns) {
            throw new Error(`Consumer modal/guide priority failed: ${JSON.stringify(overlays)}`);
          }
          overlays.dockless = await evaluate("window.qrConsumerTest.verifyDockless()");
          if (!overlays.dockless.visible || !overlays.dockless.qrDockAbsent ||
            !overlays.dockless.controlsStillReachable || !overlays.dockless.hintPassesDockClick) {
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
          contentHeight: atEnd.rootHeight, lastVisible: atEnd.lastVisible, hintDrift,
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
  const panelGuidanceViewports = [[320, 844], [360, 667], [390, 844], [1080, 1920]];
  const guidanceLayouts = [];
  await send("Page.navigate", { url: baseUrl });
  let guideFixtureLoaded = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    guideFixtureLoaded = await evaluate("Boolean(window.__sdkPackageSmoke?.readGuidance)");
    if (guideFixtureLoaded) break;
    await wait(50);
  }
  if (!guideFixtureLoaded) throw new Error("Independent shared-guidance fixture did not load.");
  await wait(350);
  let easy = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (!easy.visible || !easy.page.startsWith("1/")) throw new Error(`Easy-language panel missing: ${JSON.stringify(easy)}`);
  const easyScrollHint = await evaluate(`(() => {
    const hint = document.querySelector(".a11y-additional-menu-hint");
    const guide = document.querySelector(".a11y-guide-toast");
    const action = document.querySelector("#host-continue");
    const rect = (el) => el?.getBoundingClientRect();
    const h = rect(hint), g = rect(guide), a = rect(action);
    const overlaps = (x, y) => x && y && x.left < y.right && x.right > y.left &&
      x.top < y.bottom && x.bottom > y.top;
    return { visible: Boolean(hint && getComputedStyle(hint).visibility === "visible"),
      hint: h?.toJSON(), overlapsGuide: overlaps(h, g), overlapsAction: overlaps(h, a),
      role: hint?.getAttribute("role"), pointerEvents: hint && getComputedStyle(hint).pointerEvents };
  })()`);
  if (!easyScrollHint.visible || easyScrollHint.overlapsGuide || easyScrollHint.overlapsAction ||
    easyScrollHint.role !== "status" || easyScrollHint.pointerEvents !== "none") {
    throw new Error(`Scroll hint was missing or collided with Easy Language: ${JSON.stringify(easyScrollHint)}`);
  }
  await pointerClick("[data-a11y-guide-next]");
  await pointerClick("[data-a11y-guide-next]");
  if (!(await evaluate("window.__sdkPackageSmoke.readGuidance()")).page.startsWith("3/")) {
    throw new Error("Next-page clicks did not reach explanation page 3.");
  }
   await pointerClick("[data-a11y-guide-previous]");
   await pointerClick("[data-a11y-guide-collapse]");
  easy = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (!easy.page.startsWith("2/") || !easy.collapsed) throw new Error(`Paging/collapse failed: ${JSON.stringify(easy)}`);

  for (const [width, height] of panelGuidanceViewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height,
    });
    for (const percent of [60, 70, 80]) {
      await evaluate(`window.__sdkPackageSmoke.setViewport(${percent})`);
      await wait(80);
      const state = await evaluate(`(async () => {
        const selectors = ["#host-continue", "#test-pin", ".keypad button"];
        const hitTargets = selectors.map((selector) => {
          const target = document.querySelector(selector);
          target?.scrollIntoView({ block: "center" });
          const r = target?.getBoundingClientRect();
          const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
          return Boolean(target && r && r.width && r.height && (hit === target || target.contains(hit)));
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const panel = document.querySelector(".a11y-guide-toast");
        const p = panel?.getBoundingClientRect();
        const rect = (el) => {
          const r = el?.getBoundingClientRect();
          return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
        };
        return {
          visible: Boolean(panel && getComputedStyle(panel).visibility !== "hidden" &&
            panel.getAttribute("aria-hidden") !== "true"),
          retained: Boolean(panel), page: panel?.querySelector("[data-a11y-guide-page]")?.textContent,
          collapsed: panel?.classList.contains("a11y-guide-collapsed"),
          panel: rect(panel), action: rect(document.querySelector("#host-continue")),
          keypad: rect(document.querySelector(".keypad")), hitTargets,
          suppressionRecorded: window.__sdkPackageSmoke.read().guidePlacementDiagnostics.length > 0,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      })()`);
      const overlaps = (a, b) => a && b &&
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
      const safe = !state.horizontalOverflow && state.hitTargets.every(Boolean) &&
        (state.visible
          ? !overlaps(state.panel, state.action) && !overlaps(state.panel, state.keypad)
          : state.suppressionRecorded);
      guidanceLayouts.push({ viewport: `${width}x${height}`, bottomPercent: percent, ...state, safe });
      if (!safe) throw new Error(`Guidance is neither safely placed nor safely suppressed: ${JSON.stringify(guidanceLayouts.at(-1))}`);
      const beforePointerClicks = await evaluate("window.__sdkPackageSmoke.read()");
      await pointerClick(".keypad button");
      await pointerClick("#host-continue");
      const afterPointerClicks = await evaluate("window.__sdkPackageSmoke.read()");
      if (afterPointerClicks.keypadClicks !== beforePointerClicks.keypadClicks + 1 ||
        afterPointerClicks.actionCount !== beforePointerClicks.actionCount + 1) {
        throw new Error(`Primary controls did not receive real pointer clicks: ${JSON.stringify({ beforePointerClicks, afterPointerClicks })}`);
      }
    }
    await evaluate("window.__sdkPackageSmoke.setViewport(null)");
  }

  await evaluate(`window.__sdkPackageSmoke.moveToStep("host.payment")`);
  await wait(350);
  const singlePage = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (!singlePage.visible || !singlePage.pagerHidden || singlePage.title !== "새 단계") {
    throw new Error(`Single explanation or step change failed: ${JSON.stringify(singlePage)}`);
  }
  const beforeEnd = await evaluate("window.__sdkPackageSmoke.read().actionCount");
  const ended = await evaluate("window.__sdkPackageSmoke.endSession()");
  if (ended.panelVisible || ended.actionCount !== beforeEnd) {
    throw new Error(`endSession left guidance active or changed host business data: ${JSON.stringify(ended)}`);
  }

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await send("Page.navigate", { url: baseUrl });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    guideFixtureLoaded = await evaluate("Boolean(window.__sdkPackageSmoke?.readGuidance)");
    if (guideFixtureLoaded) break;
    await wait(50);
  }
  await pointerClick("[data-a11y-guide-next]");
  await pointerClick("[data-a11y-guide-collapse]");
  const delayStarted = await evaluate("window.__sdkPackageSmoke.startGuide(false, 10)");
  let defaultGuide;
  for (let attempt = 0; attempt < 115; attempt += 1) {
    defaultGuide = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (defaultGuide.title === "스마트 길잡이") break;
    await wait(100);
  }
  const defaultDelayMs = await evaluate(`performance.now() - ${delayStarted}`);
  if (defaultGuide?.title !== "스마트 길잡이" || defaultDelayMs < 9_500 || defaultDelayMs > 11_500 ||
    !defaultGuide.collapsed || defaultGuide.page !== "" || !defaultGuide.pagerHidden ||
    !defaultGuide.previousHidden || !defaultGuide.nextHidden || !defaultGuide.countdown.includes("10")) {
    throw new Error(`Real 10-second delay/guide start failed (${defaultDelayMs}ms): ${JSON.stringify(defaultGuide)}`);
  }
  await pointerClick("[data-a11y-guide-collapse]");
  const expandedSmartGuide = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (expandedSmartGuide.collapsed || expandedSmartGuide.title !== "스마트 길잡이" ||
    expandedSmartGuide.page !== "" || !expandedSmartGuide.pagerHidden ||
    !expandedSmartGuide.text.includes("계속 버튼을 눌러 진행하세요.")) {
    throw new Error(`Smart Guide content was mixed with easy-language paging: ${JSON.stringify(expandedSmartGuide)}`);
  }
  const defaultVisibleAt = await evaluate("performance.now()");
  await wait(1_200);
  const defaultCountdownAfter = await evaluate("window.__sdkPackageSmoke.readGuidance().countdown");
  if (Number.parseInt(defaultCountdownAfter, 10) >= 10) {
    throw new Error(`Default guide countdown did not decrease: ${defaultCountdownAfter}`);
  }
  let defaultReturned;
  for (let attempt = 0; attempt < 115; attempt += 1) {
    defaultReturned = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (defaultReturned.title === "다음으로 이동") break;
    await wait(100);
  }
  const defaultVisibleMs = await evaluate(`performance.now() - ${defaultVisibleAt}`);
  if (defaultReturned?.title !== "다음으로 이동" || !defaultReturned.page.startsWith("2/") ||
    !defaultReturned.collapsed || defaultVisibleMs < 9_300 || defaultVisibleMs > 11_500) {
    throw new Error(`Real 10-second guide return failed (${defaultVisibleMs}ms): ${JSON.stringify(defaultReturned)}`);
  }
  const slowDelayStarted = await evaluate("window.__sdkPackageSmoke.startGuide(true, 10)");
  let slowGuide;
  for (let attempt = 0; attempt < 115; attempt += 1) {
    slowGuide = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (slowGuide.title === "스마트 길잡이") break;
    await wait(100);
  }
  const slowDelayMs = await evaluate(`performance.now() - ${slowDelayStarted}`);
  if (slowGuide?.title !== "스마트 길잡이" || slowDelayMs < 9_500 || slowDelayMs > 11_500 ||
    !slowGuide.collapsed || slowGuide.page !== "" || !slowGuide.pagerHidden ||
    !slowGuide.previousHidden || !slowGuide.nextHidden || !slowGuide.countdown.includes("15")) {
    throw new Error(`Real slow-guide start failed (${slowDelayMs}ms): ${JSON.stringify(slowGuide)}`);
  }
  const slowVisibleAt = await evaluate("performance.now()");
  for (let index = 0; index < 3; index += 1) {
    await pointerClick(".keypad button:first-child");
    await pointerClick(".fixture-choices label:first-of-type");
    await pointerClick("#quantity-plus");
    await pointerClick("#quantity-minus");
  }
  await evaluate("window.scrollBy(0, 240)");
  await wait(200);
  const duringInteractions = await evaluate("window.__sdkPackageSmoke.readInteractionState()");
  if (!duringInteractions.guide.visible || duringInteractions.guide.title !== "스마트 길잡이" ||
    duringInteractions.keypadClicks < 3 || duringInteractions.optionChanges < 3 ||
    duringInteractions.quantity !== 1 || duringInteractions.scrollTop <= 0) {
    throw new Error(`Same-step input dismissed Smart Guide early: ${JSON.stringify(duringInteractions)}`);
  }
  await wait(1_200);
  const slowCountdownAfter = await evaluate("window.__sdkPackageSmoke.readGuidance().countdown");
  if (Number.parseInt(slowCountdownAfter, 10) >= 15) {
    throw new Error(`Slow guide countdown did not decrease: ${slowCountdownAfter}`);
  }
  let slowReturned;
  for (let attempt = 0; attempt < 165; attempt += 1) {
    slowReturned = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (slowReturned.title === "다음으로 이동") break;
    await wait(100);
  }
  const slowVisibleMs = await evaluate(`performance.now() - ${slowVisibleAt}`);
  if (slowReturned?.title !== "다음으로 이동" || !slowReturned.page.startsWith("2/") ||
    !slowReturned.collapsed || slowVisibleMs < 14_300 || slowVisibleMs > 16_500) {
    throw new Error(`Real 15-second guide return failed (${slowVisibleMs}ms): ${JSON.stringify(slowReturned)}`);
  }
  const sameStepInteractionResult = {
    keypadInputs: duringInteractions.keypadClicks,
    optionChanges: duringInteractions.optionChanges,
    quantityAfterIncreaseDecrease: duringInteractions.quantity,
    scrollTop: duringInteractions.scrollTop,
    guideVisibleAfterInput: duringInteractions.guide.visible,
    remainingAtObservation: duringInteractions.guide.countdown,
    totalVisibleMs: Math.round(slowVisibleMs),
    endedBy: "slowGuidance 15-second display deadline; Easy Language page restored",
  };

  const delay15Started = await evaluate("window.__sdkPackageSmoke.startGuide(false, 15)");
  let guide15;
  for (let attempt = 0; attempt < 165; attempt += 1) {
    guide15 = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (guide15.title === "스마트 길잡이") break;
    await wait(100);
  }
  const guideDelay15 = await evaluate(`performance.now() - ${delay15Started}`);
  if (guide15?.title !== "스마트 길잡이" || guideDelay15 < 14_300 || guideDelay15 > 16_500) {
    throw new Error(`Real guideDelaySeconds=15 failed (${guideDelay15}ms): ${JSON.stringify(guide15)}`);
  }
  await evaluate("document.querySelector('.a11y-guide-close').click()");
  if ((await evaluate("window.__sdkPackageSmoke.readGuidance()")).title !== "다음으로 이동") {
    throw new Error("Closing the 15-second-delay guide did not return to easy-language page 2/3.");
  }

  const delay20Started = await evaluate("window.__sdkPackageSmoke.startGuide(false, 20)");
  let guide20;
  for (let attempt = 0; attempt < 215; attempt += 1) {
    guide20 = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (guide20.title === "스마트 길잡이") break;
    await wait(100);
  }
  const guideDelay20 = await evaluate(`performance.now() - ${delay20Started}`);
    if (guide20?.title !== "스마트 길잡이" || guideDelay20 < 19_300 || guideDelay20 > 21_500) {
    throw new Error(`Real guideDelaySeconds=20 failed (${guideDelay20}ms): ${JSON.stringify(guide20)}`);
  }
  await evaluate("document.querySelector('.a11y-guide-close').click()");
  await evaluate("window.__sdkPackageSmoke.startGuide(false, 10)");
  let staleTimerGuide;
  for (let attempt = 0; attempt < 115; attempt += 1) {
    staleTimerGuide = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (staleTimerGuide.title === "스마트 길잡이") break;
    await wait(100);
  }
  if (staleTimerGuide?.title !== "스마트 길잡이") {
    throw new Error(`Could not start the guide for the stale-timer transition check: ${JSON.stringify(staleTimerGuide)}`);
  }
  await wait(1_800);
  await evaluate(`window.__sdkPackageSmoke.moveToStep("host.payment")`);
  await wait(9_000);
  const afterOldDismissDeadline = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (afterOldDismissDeadline.title !== "새 단계" || !afterOldDismissDeadline.visible ||
    !afterOldDismissDeadline.pagerHidden) {
    throw new Error(`An old guide timeout affected the next step: ${JSON.stringify(afterOldDismissDeadline)}`);
  }
  if (afterOldDismissDeadline.collapsed) {
    await evaluate("document.querySelector('[data-a11y-guide-collapse]').click()");
  }
  const expanded = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (expanded.collapsed || expanded.title !== "새 단계" || !expanded.pagerHidden) {
    throw new Error(`Single-page panel could not reopen after the timer check: ${JSON.stringify(expanded)}`);
  }
  const guidanceViewports = [[320, 844], [360, 667], [390, 844], [1080, 1920]];
  const viewportModes = [null, 60, 70, 80];
  const textFitsButton = (button, text) => button && text && text.height > 0 &&
    text.left >= button.left - 1 && text.right <= button.right + 1 &&
    text.top >= button.top - 1 && text.bottom <= button.bottom + 1;
  const profiles = [
    { textSize: "standard", buttonSize: "standard", contrast: "standard", easyLanguage: true, smartGuide: false },
    { textSize: "extraLarge", buttonSize: "large", contrast: "high", easyLanguage: true, smartGuide: false },
    { textSize: "large", buttonSize: "standard", contrast: "standard", easyLanguage: true, smartGuide: true },
    { textSize: "extraLarge", buttonSize: "large", contrast: "high", easyLanguage: true, smartGuide: true },
  ];
  const guidanceLayoutMatrix = [];
  for (const [width, height] of guidanceViewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height,
    });
    for (const percent of viewportModes) {
      for (const variant of profiles) {
        const viewportMode = percent === null ? null : { mode: "bottom", heightPercent: percent };
        await evaluate(`window.__sdkPackageSmoke.setTestProfile(${JSON.stringify({ ...variant, viewportMode })})`);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const state = await evaluate("window.__sdkPackageSmoke.readGuidance()");
        const controls = [
          state.collapseRect,
          state.previousRect,
          state.nextRect,
        ];
        const buttonsFit = controls.every((rect) => rect && rect.width >= 44 &&
          Math.abs(rect.height - 44) < 0.1) &&
          textFitsButton(state.collapseRect, state.collapseTextRect) &&
          textFitsButton(state.previousRect, state.previousTextRect) &&
          textFitsButton(state.nextRect, state.nextTextRect);
        const minBodyFont = variant.textSize === "extraLarge" ? 20 :
          variant.textSize === "large" ? 17.5 : 16;
        const panel = state.panelRect;
        const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left &&
          a.top < b.bottom && a.bottom > b.top;
        if (!state.visible || !state.textVisible || state.collapsed || !buttonsFit ||
          !state.textRect || !panel || state.panelRect.left < 0 || state.panelRect.right > width ||
          overlaps(panel, state.actionRect) || overlaps(panel, state.keypadRect) ||
          Number.parseFloat(state.bodyFontSize) < minBodyFont ||
          state.iconAriaHidden !== "true" || state.iconRect.width > 20 ||
          state.collapseAccessibleName !== "안내 접기" ||
          state.headerRect.height > (percent === 80 ? 56 : 44) ||
          !state.page.startsWith("1/")) {
          throw new Error(`Guidance layout failed at ${width}x${height}, viewport=${percent}: ${JSON.stringify(state)}`);
        }
        guidanceLayoutMatrix.push({
          viewport: `${width}x${height}`,
          viewportMode: percent ?? "null",
          profile: `${variant.textSize}/${variant.buttonSize}/${variant.contrast}`,
          panelHeight: Math.round(panel.bottom - panel.top),
          collapseTarget: `${Math.round(state.collapseRect.width)}x${Math.round(state.collapseRect.height)}`,
          previousTarget: `${Math.round(state.previousRect.width)}x${Math.round(state.previousRect.height)}`,
          nextTarget: `${Math.round(state.nextRect.width)}x${Math.round(state.nextRect.height)}`,
          bodyFontSize: state.bodyFontSize,
        });
      }
    }
  }
  const smartOnlyLayouts = [];
  for (const [width, height, percent] of [[320, 844, null], [1080, 1920, 80]]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height,
    });
    const viewportMode = percent === null ? null : { mode: "bottom", heightPercent: percent };
    await evaluate(`window.__sdkPackageSmoke.setTestProfile(${JSON.stringify({
      textSize: "extraLarge", buttonSize: "large", contrast: "high",
      easyLanguage: false, smartGuide: true, viewportMode,
    })})`);
    const started = await evaluate("window.__sdkPackageSmoke.startGuide(false, 10)");
    let smart;
    for (let attempt = 0; attempt < 115; attempt += 1) {
      smart = await evaluate("window.__sdkPackageSmoke.readGuidance()");
      if (smart.title === "스마트 길잡이") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await wait(350);
    smart = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (smart?.title !== "스마트 길잡이" || !smart.visible || !smart.pagerHidden ||
      !smart.previousHidden || !smart.nextHidden || !smart.countdown ||
           smart.closeRect.width < 44 || Math.abs(smart.closeRect.height - 44) >= 0.1 ||
           smart.collapseRect.width < 44 || Math.abs(smart.collapseRect.height - 44) >= 0.1 ||
           !textFitsButton(smart.closeRect, smart.closeTextRect) ||
           !textFitsButton(smart.collapseRect, smart.collapseTextRect) ||
      smart.iconRect.width !== 0 || smart.closeLabel !== "안내 닫기" ||
      smart.collapseAccessibleName !== "안내 접기" || smart.headerRect.height > 44) {
      throw new Error(`Smart Guide-only layout failed at ${width}x${height}: ${JSON.stringify(smart)}`);
    }
    smartOnlyLayouts.push({ viewport: `${width}x${height}`, viewportMode: percent ?? "null",
      elapsedMs: Math.round((await evaluate(`performance.now() - ${started}`))),
      panelHeight: Math.round(smart.panelRect.bottom - smart.panelRect.top) });
    await evaluate("document.querySelector('.a11y-guide-close').click()");
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await evaluate(`window.__sdkPackageSmoke.setTestProfile(${JSON.stringify({
    textSize: "extraLarge", buttonSize: "large", contrast: "high",
    easyLanguage: true, smartGuide: false, viewportMode: null,
  })})`);
  await wait(350);
  await evaluate("document.querySelector('[data-a11y-guide-collapse]').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  const keyboardForward = await evaluate(`({
    nextFocused: document.activeElement?.dataset?.a11yGuideNext === "true",
    outline: getComputedStyle(document.activeElement).outlineStyle,
  })`);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8,
  });
  const keyboardBackward = await evaluate(`({
    collapseFocused: document.activeElement?.dataset?.a11yGuideCollapse === "true",
    outline: getComputedStyle(document.activeElement).outlineStyle,
  })`);
  if (!keyboardForward.nextFocused || keyboardForward.outline === "none" ||
    !keyboardBackward.collapseFocused || keyboardBackward.outline === "none") {
    throw new Error(`Guide controls are not keyboard reachable: ${JSON.stringify({ keyboardForward, keyboardBackward })}`);
  }
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const reducedMotion = await evaluate(`({
    animationName: getComputedStyle(document.querySelector(".a11y-guide-toast")).animationName,
    visible: getComputedStyle(document.querySelector(".a11y-guide-toast")).visibility === "visible",
  })`);
  if (reducedMotion.animationName !== "none" || !reducedMotion.visible) {
    throw new Error(`Reduced-motion preference was not honored: ${JSON.stringify(reducedMotion)}`);
  }
  const stageGuidanceCases = [];
  const panelStabilityCases = [];
  const topDrift = (samples, selector) => {
    const visible = samples.filter((sample) => sample[selector]?.visible);
    return visible.length < 2 ? null : Math.max(...visible.map((sample) =>
      Math.abs(sample[selector].rect.top - visible[0][selector].rect.top)));
  };
  for (const [width, height] of [[320, 844], [360, 667], [390, 844], [1080, 1920]]) {
    for (const percent of [null, 60, 70, 80]) {
      for (const guideMode of ["easy", "smart", "both"]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: width < 600,
        screenWidth: width, screenHeight: height,
      });
      await send("Page.navigate", { url: `${baseUrl}/` });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        ready = await evaluate("Boolean(window.__sdkPackageSmoke?.runStageGuidanceProbe)");
        if (ready) break;
        await wait(50);
      }
      if (!ready) throw new Error("The .stage guidance fixture did not load.");
      const probe = await evaluate(
        `window.__sdkPackageSmoke.runStageGuidanceProbe(${JSON.stringify(percent)}, ${JSON.stringify(guideMode)})`,
      );
      const easyGuideDrift = topDrift(probe.easy, "guide");
      const smartGuideDrift = topDrift(probe.smart, "guide");
      const samples = [...probe.easy, ...probe.smart];
      const hintSamples = samples.filter((sample) => sample.hint?.visible);
      const hintDrift = topDrift(samples, "hint");
      const scrollSamples = samples.filter((sample) => sample.scrollTop < probe.maxScroll - 1);
      const endSamples = samples.filter((sample) => sample.scrollTop >= probe.maxScroll - 1);
      const badActionHits = samples.flatMap((sample) =>
        sample.hitTests.filter((item) => item.visible && !item.hit));
      const visualOverlaps = samples.flatMap((sample) =>
        sample.hitTests.filter((item) => item.visible && (item.guideOverlap || item.hintOverlap)));
      const result = {
        width, height, percent, guideMode, easyGuideDrift, smartGuideDrift, hintDrift,
        visibleHintSamples: hintSamples.length,
        activeScrollHintSamples: scrollSamples.filter((sample) => sample.hint?.visible).length,
        endHintHidden: endSamples.length > 0 && endSamples.every((sample) => !sample.hint?.visible),
        smartVisible: probe.smartVisible,
        badActionHits, visualOverlaps: visualOverlaps.length,
        easy: probe.easy.map((sample) => ({
          scrollTop: sample.scrollTop, stageTop: sample.stage.top,
          guideTop: sample.guide?.rect.top, hintTop: sample.hint?.rect.top,
          hintVisible: sample.hint?.visible,
        })),
        smart: probe.smart.map((sample) => ({
          scrollTop: sample.scrollTop, guideTop: sample.guide?.rect.top,
          hintVisible: sample.hint?.visible,
        })),
      };
      const guides = guideMode === "easy" ? probe.easy
        : guideMode === "smart" ? probe.smart : [...probe.easy, ...probe.smart];
      if (probe.stageScrollHeight <= probe.stageClientHeight ||
          easyGuideDrift > 1 || smartGuideDrift > 1 || hintDrift > 1 || badActionHits.length ||
          scrollSamples.some((sample) => !sample.hint?.visible) ||
          !endSamples.length || endSamples.some((sample) => sample.hint?.visible) ||
          guides.some((sample) => !sample.guide?.visible) ||
          (guideMode !== "easy" && !probe.smartVisible)) {
        throw new Error(`.stage guidance geometry was unstable: ${JSON.stringify(result)}`);
      }
      stageGuidanceCases.push(result);
       if (guideMode === "both") {
         await send("Page.navigate", { url: `${baseUrl}/` });
         for (let attempt = 0; attempt < 100; attempt += 1) {
           if (await evaluate("Boolean(window.__sdkPackageSmoke?.runPanelStabilityProbe)")) break;
           await wait(50);
         }
         const panelProbe = await evaluate(
            `window.__sdkPackageSmoke.runPanelStabilityProbe(${JSON.stringify(percent)}, ${JSON.stringify(width === 360 && height === 667 && percent === 80)})`,
         );
         const visiblePanels = panelProbe.samples.filter((sample) => sample.visible);
         const drift = Math.max(...visiblePanels.map((sample) => sample.top)) -
           Math.min(...visiblePanels.map((sample) => sample.top));
         const undersizedButtons = panelProbe.samples.flatMap((sample) =>
           sample.buttons.filter((button) => !button.hidden &&
             (button.width < 44 || button.height < 44)));
         const easyTransitionSamples = panelProbe.samples.filter((_, index) =>
           index !== 4 && index !== 6);
         const pageNumbers = panelProbe.samples.map((sample) =>
           Number(sample.page.split("/")[0] || 0));
         const invalidBounds = panelProbe.samples.filter((sample) =>
           !sample.visible || sample.top < 0 || sample.bottom > height);
         const stability = { width, height, percent, drift, undersizedButtons,
           invalidBounds, samples: panelProbe.samples, dock: panelProbe.dock,
           footer: panelProbe.footer, hint: panelProbe.hint,
            allLongTextPreserved: !panelProbe.deepAudit ||
              panelProbe.collectedLongText === panelProbe.originalLongText,
           longTextLengths: panelProbe.longTextLengths,
           textDifference: panelProbe.textDifference,
           longPages: panelProbe.pageCount };
         if (drift > 1 || undersizedButtons.length || invalidBounds.length ||
           visiblePanels.length !== panelProbe.samples.length ||
           easyTransitionSamples.some((sample) => sample.collapsed) ||
           pageNumbers[0] !== 1 || pageNumbers[1] !== 2 || pageNumbers[2] !== 1 ||
           pageNumbers[3] !== 2 || pageNumbers[4] !== 2 || pageNumbers[5] !== 2 ||
           panelProbe.samples[6].page !== "" || pageNumbers[7] !== 2 ||
            (panelProbe.deepAudit && panelProbe.collectedLongText !== panelProbe.originalLongText) ||
           panelProbe.samples.some((sample) => sample.scrollable || sample.overflow !== "hidden") ||
           panelProbe.dock.bottom > panelProbe.footer.top + 1 ||
           (panelProbe.hint.visible && panelProbe.hint.position !== "fixed")) {
           throw new Error(`Guidance panel position changed during content/state transitions: ${JSON.stringify(stability)}`);
         }
         panelStabilityCases.push(stability);
       }
      }
    }
  }
  const viewportReflowCases = [];
  for (const [width, height] of viewports.slice(0, 4)) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
      screenWidth: width, screenHeight: height,
    });
    await send("Page.navigate", { url: `${baseUrl}/` });
    let loaded = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      loaded = await evaluate("Boolean(window.__sdkPackageSmoke?.runViewportReflowProbe)");
      if (loaded) break;
      await wait(50);
    }
    if (!loaded) throw new Error(`Viewport reflow fixture did not load at ${width}x${height}.`);
    const report = await evaluate("window.__sdkPackageSmoke.runViewportReflowProbe()");
    if (report.transitions.length !== 12 ||
        report.transitions.some((item) => !item.textPreserved || !item.anchorPreserved ||
          item.textClipped || item.outside.length || item.bodyScrollable || item.collapsed)) {
      throw new Error(`Dynamic viewport reflow failed at ${width}x${height}: ${JSON.stringify(report)}`);
    }
    viewportReflowCases.push(report);
  }
  console.log(JSON.stringify({
    installedPackageCssBrowserCases: cases.length,
    sharedGuidanceLayouts: guidanceLayouts,
    easyPageAfterEndSession: ended,
    realTimingMs: {
      guideDelay10: defaultDelayMs,
      defaultDisplay10: defaultVisibleMs,
      slowDelay10: slowDelayMs,
      slowDisplay15: slowVisibleMs,
      guideDelay15,
      guideDelay20,
      countdownDecreased: { default: defaultCountdownAfter, slow: slowCountdownAfter },
    },
    sameStepInteractionResult,
    fontCorrectionCases,
    guidanceLayoutCases: guidanceLayoutMatrix.length,
    panelStabilityCases,
    viewportReflowCases,
    guidanceLayoutMatrix,
    smartOnlyLayouts,
    keyboardForward,
    keyboardBackward,
    reducedMotion,
    stageGuidanceCases,
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
