import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const consumerRoot = process.env.KIOSK_SDK_CONSUMER_ROOT;
if (!consumerRoot) throw new Error("KIOSK_SDK_CONSUMER_ROOT is required.");
const repositoryRoot = resolve(new URL("../../..", import.meta.url).pathname);
const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const width = Number(process.env.COPY_WIDTH || 320);
const height = Number(process.env.COPY_HEIGHT || 844);
const caseName = process.env.COPY_CASE || "typeSelection";
const viewportChoice = process.env.COPY_MODE || "80";
const port = 49100 + (process.pid % 700);
const debugPort = port + 700;
const baseUrl = `http://127.0.0.1:${port}`;
const userData = await mkdtemp(join(tmpdir(), "certificate-copy-chromium-"));
const vite = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/.bin/vite"),
  "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", "build",
], { cwd: consumerRoot, stdio: "ignore" });
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });
let socket;

const stop = (child, processGroup = false) => {
  if (!child || child.exitCode !== null) return;
  try {
    if (processGroup) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {}
};

try {
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) { ready = true; break; }
    } catch {}
    if (vite.exitCode !== null) throw new Error(`Vite preview exited with ${vite.exitCode}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Consumer preview did not start.");

  let target;
  for (let i = 0; i < 100; i += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((item) => item.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target) throw new Error("Chromium did not start.");
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
    socket.send(JSON.stringify({ id: requestId, ...params, method }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      params: { expression, returnByValue: true, awaitPromise: true },
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };
  await send("Emulation.setDeviceMetricsOverride", {
    params: { width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height },
  });
  await send("Page.navigate", { params: { url: baseUrl } });
  let loaded = false;
  for (let i = 0; i < 100; i += 1) {
    loaded = await evaluate("Boolean(window.__sdkPackageSmoke?.setCertificateCopy)");
    if (loaded) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!loaded) throw new Error("Certificate-copy fixture did not load.");
  const expected = await evaluate(`window.__sdkPackageSmoke.setCertificateCopy(
    ${JSON.stringify(caseName)}, ${JSON.stringify(viewportChoice)})`);
  await new Promise((resolve) => setTimeout(resolve, 350));

  const pages = [];
  const maxPages = 500;
  for (let i = 0; i < maxPages; i += 1) {
    const sample = await evaluate(`(() => {
      const state = window.__sdkPackageSmoke.readGuidance();
      const panel = document.querySelector(".a11y-guide-toast");
      const rect = (selector) => {
        const element = panel?.querySelector(selector);
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
          width: box.width, height: box.height } : null;
      };
      const panelStyle = panel ? getComputedStyle(panel) : null;
      const kioskRoot = document.querySelector("#kiosk-root");
      const rootRect = document.querySelector("#kiosk-root")?.getBoundingClientRect();
      return {
        page: state.page, pageCount: state.pageCount, title: state.title, text: state.text,
        panel: state.panelRect, header: state.headerRect, copy: rect(".a11y-guide-copy"),
         titleRect: state.titleRect,
        copyMetrics: (() => {
          const element = panel?.querySelector(".a11y-guide-copy");
          if (!element) return null;
          const style = getComputedStyle(element);
          return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
            overflowY: style.overflowY, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
        })(),
        body: state.textRect, textMetrics: state.textMetrics,
        pager: rect(".a11y-guide-pager"),
        previous: rect("[data-a11y-guide-previous]"), next: rect("[data-a11y-guide-next]"),
        viewportArea: (() => {
          const area = document.querySelector(".a11y-bottom-viewport-scroll-area");
          if (!area) return null;
          const box = area.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height,
            clientHeight: area.clientHeight, scrollHeight: area.scrollHeight };
        })(),
        mode: window.__sdkPackageSmoke.read().profile.viewportMode,
        effectiveViewportActive: Boolean(kioskRoot?.classList.contains("a11y-bottom-viewport-enabled")),
        effectiveViewportHeight: kioskRoot?.style.getPropertyValue("--a11y-bottom-viewport-height") ?? "",
        panelStyleTop: panel?.style.top ?? "",
        rootRect: rootRect ? { top: rootRect.top, bottom: rootRect.bottom, height: rootRect.height } : null,
        panelLayout: panel && panelStyle ? {
          maxHeight: panel.style.maxHeight,
          paddingTop: panelStyle.paddingTop,
          paddingBottom: panelStyle.paddingBottom,
          rowGap: panelStyle.rowGap,
          borderTop: panelStyle.borderTopWidth,
          borderBottom: panelStyle.borderBottomWidth,
          overflow: panelStyle.overflow,
        } : null,
      };
    })()`);
    pages.push(sample);
    const next = await evaluate(`(() => {
      const button = document.querySelector(".a11y-guide-toast [data-a11y-guide-next]");
      if (!button || button.hidden || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return hit === button || button.contains(hit) ? { x, y } : null;
    })()`);
    if (!next) break;
    await send("Input.dispatchMouseEvent", {
      params: { type: "mouseMoved", x: next.x, y: next.y },
    });
    await send("Input.dispatchMouseEvent", {
      params: { type: "mousePressed", x: next.x, y: next.y, button: "left", buttons: 1, clickCount: 1 },
    });
    await send("Input.dispatchMouseEvent", {
      params: { type: "mouseReleased", x: next.x, y: next.y, button: "left", buttons: 0, clickCount: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 320));
  }

  let interactionTest = null;
  if (width === 360 && height === 667 && viewportChoice === "70" && caseName === "typeSelection") {
    const intersects = (a, b) => a && b && a.width > 0 && b.width > 0 &&
      Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
    const headerOverlaps = [
      ["title", "pager"],
    ].filter(([first, second]) => intersects(pages[0]?.[first], pages[0]?.[second]));
    if (headerOverlaps.length) throw new Error(`70% header controls overlap: ${JSON.stringify(headerOverlaps)}`);
    const clickControl = async (selector) => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await new Promise((resolve) => setTimeout(resolve, 320));
      return evaluate("window.__sdkPackageSmoke.readGuidance()");
    };
    const previous = await clickControl("[data-a11y-guide-previous]");
    if (previous.page !== "1/2" || previous.text !== pages[0]?.text) {
      throw new Error(`Previous did not restore page 1: ${JSON.stringify(previous)}`);
    }
    const next = await clickControl("[data-a11y-guide-next]");
    if (next.page !== "2/2" || next.text !== pages.at(-1)?.text) {
      throw new Error(`Next did not restore page 2: ${JSON.stringify(next)}`);
    }
    const foldButtonAbsent = await evaluate("!document.querySelector('[data-a11y-guide-collapse]')");
    const expanded = await evaluate("window.__sdkPackageSmoke.readGuidance()");
    if (!foldButtonAbsent || expanded.collapsed || expanded.page !== "2/2" ||
        expanded.text !== pages.at(-1)?.text) {
      throw new Error(`Fold controls must be absent while preserving the selected page: ${JSON.stringify({ foldButtonAbsent, expanded })}`);
    }
    interactionTest = {
      previousPage: previous.page,
      nextPage: next.page,
      foldButtonAbsent,
      pageAfterExpand: expanded.page,
      headerOverlaps,
    };
  }

  const grouped = new Map();
  for (const page of pages) {
    const group = grouped.get(page.title) ?? [];
    group.push(page.text);
    grouped.set(page.title, group);
  }
  const comparisons = expected.explanations.map((explanation) => {
    const observed = grouped.get(explanation.title) ?? [];
    const joined = observed.join("");
    return {
      title: explanation.title,
      expectedCharacters: Array.from(explanation.text).length,
      pages: observed.length,
      pageCharacters: observed.map((text) => Array.from(text).length),
      exactTextPreserved: joined === explanation.text,
    };
  });
  const report = {
    viewport: `${width}x${height}`,
    caseName,
    profile: {
      stepId: expected.stepId,
      textSize: "extraLarge",
      buttonSize: "large",
      contrast: "high",
      easyLanguage: true,
      smartGuide: true,
      viewportMode: expected.viewportMode,
    },
    effectiveViewportActive: pages[0]?.effectiveViewportActive ?? false,
    effectiveViewportHeight: pages[0]?.effectiveViewportHeight ?? "",
    pageCount: pages.length,
    stableReportedPageCount: new Set(pages.map((page) => page.pageCount)).size <= 1,
    interactionTest,
    pageTopRange: pages.length ? [
      Math.min(...pages.map((page) => page.panel.top)),
      Math.max(...pages.map((page) => page.panel.top)),
    ] : [],
    oneCharacterPages: pages.filter((page) => Array.from(page.text.trim()).length <= 1)
      .map((page) => page.page),
    controlsFit: pages.every((page) => [page.previous, page.next].every((button) =>
      !button || button.width === 0 ||
      (button.width >= 44 && button.height >= 44 &&
       button.left >= page.panel.left - 1 && button.right <= page.panel.right + 1 &&
       button.top >= page.panel.top - 1 && button.bottom <= page.panel.bottom + 1))),
    comparisons,
    pages,
   textClipped: pages.some((page) =>
     (page.copyMetrics?.overflowY === "hidden" &&
      page.copyMetrics.scrollHeight > page.copyMetrics.clientHeight + 1)),
  };
  console.log(JSON.stringify(report, null, 2));
  if (pages.length >= maxPages || comparisons.some((item) => !item.exactTextPreserved) ||
      report.textClipped || report.oneCharacterPages.length || !report.controlsFit ||
       !report.stableReportedPageCount ||
      report.pageTopRange[1] - report.pageTopRange[0] > 1) {
    process.exitCode = 1;
  }
} finally {
  socket?.close();
  stop(browser, true);
  stop(vite);
  await Promise.all([browser, vite].map((child) => new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  })));
  await rm(userData, { recursive: true, force: true });
}
