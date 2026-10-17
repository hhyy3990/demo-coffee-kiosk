import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const consumerRoot = process.env.KIOSK_SDK_CONSUMER_ROOT;
if (!consumerRoot) throw new Error("KIOSK_SDK_CONSUMER_ROOT is required.");
const repositoryRoot = process.cwd();
const port = 49200 + process.pid % 700;
const debugPort = port + 700;
const baseUrl = `http://127.0.0.1:${port}`;
const userData = await mkdtemp(join(tmpdir(), "sdk-smart-guide-chromium-"));
const vite = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/.bin/vite"), "preview", "--host", "127.0.0.1",
  "--port", String(port), "--strictPort", "--outDir", "build",
], { cwd: consumerRoot, stdio: "ignore" });
const browser = spawn(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });

let socket;
try {
  let response;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { response = await fetch(baseUrl); if (response.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!response?.ok) throw new Error("Consumer preview did not start.");
  let target;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((item) => item.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target) throw new Error("Chromium page did not start.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const warningMessages = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "warning") {
      warningMessages.push(message.params.args.map((arg) => arg.value ?? "").join(" "));
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, predicate, timeoutMs = 1500) => {
    const started = Date.now();
    let value;
    do {
      value = await evaluate(expression);
      if (predicate(value)) return value;
      await wait(50);
    } while (Date.now() - started < timeoutMs);
    throw new Error(`Timed out waiting for browser state: ${JSON.stringify(value)}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 320, screenHeight: 844,
  });
  await send("Page.navigate", { url: baseUrl });
  await poll("Boolean(window.__sdkPackageSmoke?.startGuide)", Boolean);

  const longText = "증명서 종류, 발급 부수, 표시 항목과 수수료를 확인해 주세요. 내용이 맞으면 결제 방법을 눌러 가상 결제를 진행하세요.";
  if ([...longText].length !== 67) {
    throw new Error(`Expected the supplied payment guide length to remain 67; got ${[...longText].length}.`);
  }
  const run = async (slow, text, expectedPages, totalMs, halfMs = 0, restoreEasy = false) => {
    await evaluate(`window.__sdkPackageSmoke.setTestProfile({
      textSize:"extraLarge",buttonSize:"large",contrast:"high",easyLanguage:true,smartGuide:true,
      viewportMode:{mode:"bottom",heightPercent:80}
    })`);
    let restoreBefore = null;
    if (restoreEasy) {
      await evaluate(`document.querySelector("[data-a11y-guide-next]").click();
        document.querySelector("[data-a11y-guide-collapse]").click()`);
      restoreBefore = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    }
    await evaluate(`window.__sdkPackageSmoke.startGuide(${slow},10,${JSON.stringify(text)})`);
    let state = await poll("window.__sdkPackageSmoke.readGuidance()", (item) =>
      item.title === "스마트 길잡이", 11_200);
    await wait(350);
    state = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    const displayStarted = await evaluate("performance.now()");
    const firstText = state.text;
    const first = state;
    const firstGeometry = await evaluate(`(() => {
      const panel = document.querySelector(".a11y-guide-toast");
      const copy = panel.querySelector(".a11y-guide-copy");
      const rect = (selector) => {
        const box = panel.querySelector(selector).getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
          width: box.width, height: box.height };
      };
      const style = getComputedStyle(panel);
      return {
        panelMaxHeight: panel.style.maxHeight,
        panelTop: panel.getBoundingClientRect().top,
        headerHeight: rect(".a11y-guide-header").height,
        headerGap: getComputedStyle(panel.querySelector(".a11y-guide-header")).gap,
        panelPadding: style.padding,
        textAvailableHeight: rect(".a11y-guide-copy").height,
        copyScrollHeight: copy.scrollHeight,
        copyClientHeight: copy.clientHeight,
        textScrollHeight: panel.querySelector("[data-a11y-guide-text]").scrollHeight,
        textClientHeight: panel.querySelector("[data-a11y-guide-text]").clientHeight,
        textLineHeight: getComputedStyle(panel.querySelector("[data-a11y-guide-text]")).lineHeight,
        close: rect(".a11y-guide-close"),
        collapse: rect("[data-a11y-guide-collapse]"),
        title: rect("[data-a11y-guide-title]"),
        countdown: rect("[data-a11y-guide-countdown]"),
        workAreaHeight: document.querySelector(".a11y-bottom-viewport-scroll-area")?.getBoundingClientRect().height ?? null,
      };
    })()`);
    if (expectedPages === 2) {
      if (Math.abs(first.panelRect.top - 8) > 1 ||
          firstGeometry.headerHeight > 44.1 ||
          firstGeometry.close.width < 44 || firstGeometry.close.height < 44 ||
          firstGeometry.collapse.width < 44 || firstGeometry.collapse.height < 44 ||
          firstGeometry.copyScrollHeight > firstGeometry.copyClientHeight ||
          firstGeometry.textScrollHeight > firstGeometry.textClientHeight + 1) {
        throw new Error(`360/320 Smart Guide geometry failed: ${JSON.stringify(firstGeometry)}`);
      }
      for (const [a, b] of [[firstGeometry.title, firstGeometry.countdown],
        [firstGeometry.title, firstGeometry.close], [firstGeometry.title, firstGeometry.collapse],
        [firstGeometry.countdown, firstGeometry.close]]) {
        if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1) {
          throw new Error(`Smart Guide header items overlap: ${JSON.stringify({ a, b, firstGeometry })}`);
        }
      }
    }
    if (expectedPages === 2) {
      state = await poll("window.__sdkPackageSmoke.readGuidance()", (item) =>
        item.title === "스마트 길잡이" && item.text !== firstText, halfMs + 1200);
      const transitionAt = await evaluate("performance.now()");
      if (Math.abs((transitionAt - displayStarted) - halfMs) > 1200) {
        throw new Error(`Page transition was late: ${transitionAt - displayStarted}ms after display, expected ${halfMs}ms.`);
      }
      if (firstText + state.text !== text) throw new Error("Two-page Smart Guide changed or lost source text.");
      for (const pageState of [first, state]) {
        if (pageState.textMetrics.scrollHeight > pageState.textMetrics.clientHeight + 1) {
          throw new Error(`Smart Guide page clipped: ${JSON.stringify(pageState.textMetrics)}`);
        }
      }
      if (Math.abs(first.panelRect.top - state.panelRect.top) > 1) {
        throw new Error("Smart Guide panel moved during the automatic page transition.");
      }
    } else if (firstText !== text) {
      throw new Error("Single-page Smart Guide changed its source text.");
    }
    await poll("window.__sdkPackageSmoke.readGuidance()", (item) =>
      item.title !== "스마트 길잡이", totalMs + 1500);
    const elapsed = await evaluate(`performance.now() - ${displayStarted}`);
    if (Math.abs(elapsed - totalMs) > 1500) {
      throw new Error(`Smart Guide display time was ${elapsed}ms, expected ${totalMs}ms.`);
    }
    const restored = restoreEasy ? await evaluate(`({
      collapsed: document.querySelector(".a11y-guide-toast")?.classList.contains("a11y-guide-collapsed"),
      page: document.querySelector("[data-a11y-guide-page]")?.textContent
    })`) : null;
    if (restoreEasy && (restored.collapsed !== restoreBefore.collapsed || restored.page !== restoreBefore.page)) {
      throw new Error(`Easy Language page/fold state did not restore: ${JSON.stringify({ before: restoreBefore, after: restored })}`);
    }
    return { slow, expectedPages, elapsed: Math.round(elapsed), firstText, secondText: state.text,
      firstGeometry, restored: restoreEasy ? { before: restoreBefore, after: restored } : null };
  };

  await send("Emulation.setDeviceMetricsOverride", {
    width: 360, height: 667, deviceScaleFactor: 1, mobile: true,
    screenWidth: 360, screenHeight: 667,
  });
  await evaluate(`window.__sdkPackageSmoke.setTestProfile({
    textSize:"extraLarge",buttonSize:"large",contrast:"high",easyLanguage:true,smartGuide:true,
    viewportMode:{mode:"bottom",heightPercent:80}
  })`);
  await evaluate(`window.__sdkPackageSmoke.startGuide(false,10,${JSON.stringify(longText)})`);
  await poll("window.__sdkPackageSmoke.readGuidance()", (item) => item.title === "스마트 길잡이", 11_200);
  await wait(350);
  const layoutState = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (!layoutState.textVisible || layoutState.textMetrics.scrollHeight > layoutState.textMetrics.clientHeight + 1 ||
      Math.abs(layoutState.panelRect.top - 8) > 1) {
    throw new Error(`Smart Guide did not fit 360x667 explicit80: ${JSON.stringify(layoutState)}`);
  }
  await evaluate('document.querySelector(".a11y-guide-close").click()');
  const layoutMatrix = [{ viewport: "360x667", mode: "explicit80", firstPageText: layoutState.text }];

  await send("Emulation.setDeviceMetricsOverride", {
    width: 360, height: 667, deviceScaleFactor: 1, mobile: true,
    screenWidth: 360, screenHeight: 667,
  });
  await evaluate(`window.__sdkPackageSmoke.setTestProfile({
    textSize:"extraLarge",buttonSize:"large",contrast:"high",easyLanguage:true,smartGuide:true,
    viewportMode:{mode:"bottom",heightPercent:80}
  })`);
  await evaluate(`window.__sdkPackageSmoke.startGuide(false,10,${JSON.stringify(longText.repeat(6))})`);
  await wait(10_500);
  const tooLongFallback = await evaluate("window.__sdkPackageSmoke.readGuidance()");
  if (!warningMessages.some((message) => /requires \d+ pages; maximum is 2/u.test(message))) {
    throw new Error(`A Smart Guide requiring more than two pages was not logged with its step and page count: ${JSON.stringify({ warningMessages, state: tooLongFallback })}`);
  }

  const results = [];
  results.push(await run(false, "다음 버튼을 눌러 진행하세요.", 1, 10_000));
  results.push(await run(false, longText, 2, 15_000, 7_500));
  results.push(await run(true, "다음 버튼을 눌러 진행하세요.", 1, 20_000));
  results.push(await run(true, longText, 2, 20_000, 10_000));
  const guideDelays = [];
  for (const seconds of [10, 15, 20]) {
    const started = await evaluate(
      `window.__sdkPackageSmoke.startGuide(false,${seconds},"다음 버튼을 눌러 진행하세요.")`,
    );
    await poll("window.__sdkPackageSmoke.readGuidance()", (item) => item.title === "스마트 길잡이",
      seconds * 1000 + 1200);
    const elapsed = await evaluate(`performance.now() - ${started}`);
    if (Math.abs(elapsed - seconds * 1000) > 1200) {
      throw new Error(`guideDelaySeconds=${seconds} began after ${elapsed}ms.`);
    }
    await evaluate('document.querySelector(".a11y-guide-close").click()');
    guideDelays.push({ seconds, elapsed: Math.round(elapsed) });
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 360, height: 667, deviceScaleFactor: 1, mobile: true,
    screenWidth: 360, screenHeight: 667,
  });
  results.push(await run(false, longText, 2, 15_000, 7_500, true));
  console.log(JSON.stringify({
    result: "PASS", suppliedTextLength: [...longText].length, results,
    layoutCases: layoutMatrix.length, oversizedGuidePreservedBySuppression: tooLongFallback.title !== "스마트 길잡이",
    guideDelays,
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  vite.kill("SIGTERM");
  await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
