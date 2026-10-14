import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const viewports = [[320, 844], [360, 667], [390, 844], [1080, 1920]];
const structures = ["document", "long-menu", "fixed-controls"];
const percentages = [60, 70, 80];
const scenarios = viewports.flatMap((viewport) => [
  { viewport, structure: "document", percent: 70 },
  ...structures.slice(1).flatMap((structure) =>
    percentages.map((percent) => ({ viewport, structure, percent })),
  ),
]);
const reports = [];
const guideObstructions = [];

for (const [index, { viewport, structure, percent }] of scenarios.entries()) {
  const [viewWidth, viewHeight] = viewport;
  let completionAutoReturnMs = null;
  const externalPort = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : undefined;
  const port = externalPort ?? 9690 + index;
  const child = externalPort ? null : spawn(chromium, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/qr-entry-poc-${process.pid}-${port}`,
    "about:blank",
  ], { stdio: "ignore", detached: true });
  let socket;
  try {
    let page;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${port}/json/list`))
          .json()).find((target) => target.type === "page");
        if (page) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!page) throw new Error(`Chromium did not start for ${viewWidth}x${viewHeight}.`);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result?.value;
    };
    const clickTarget = async (selector, mayDismissGuide = true) => {
      const point = await evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return null;
        target.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const guideRect = document.querySelector(".a11y-guide-toast")?.getBoundingClientRect();
        return {
          x, y, visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
          hit: hit === target || target.contains(hit),
          hitElement: hit ? [hit.tagName.toLowerCase(), hit.id, String(hit.className)].join("|") : "none",
          targetRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          guideRect: guideRect ? { top: guideRect.top, bottom: guideRect.bottom, left: guideRect.left, right: guideRect.right } : null,
        };
      })()`);
      if (!point?.visible || !point.hit) {
        if (mayDismissGuide && point?.guideRect && point.hitElement.startsWith("aside|")) {
          guideObstructions.push({ viewport: `${viewWidth}x${viewHeight}`, percent, selector, ...point });
          const closePoint = await evaluate(`(() => {
            const target = document.querySelector(".a11y-guide-close");
            if (!target) return null;
            const rect = target.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
              hit: hit === target || target.contains(hit) };
          })()`);
          if (!closePoint?.visible || !closePoint.hit) {
            throw new Error(`SDK guide blocked ${selector}, and its close control was not hittable: ${JSON.stringify({ point, closePoint })}`);
          }
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: closePoint.x, y: closePoint.y });
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: closePoint.x, y: closePoint.y, button: "left", buttons: 1, clickCount: 1 });
          await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: closePoint.x, y: closePoint.y, button: "left", buttons: 0, clickCount: 1 });
          await new Promise((resolve) => setTimeout(resolve, 80));
          return clickTarget(selector, false);
        }
        throw new Error(`Button is not visibly hit-testable (${viewWidth}x${viewHeight}, ${percent}%, ${selector}): ${JSON.stringify(point)}`);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    };
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewWidth, height: viewHeight, deviceScaleFactor: 1, mobile: false,
      screenWidth: viewWidth, screenHeight: viewHeight,
    });
    if (structure === "long-menu") {
      await send("Page.navigate", { url: `http://127.0.0.1:5000/?bottom-sdk=${percent}` });
    }
    if (structure === "long-menu") {
    let homeReady = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      homeReady = await evaluate("Boolean(document.querySelector('.a11y-qr-entry-dock-button'))");
      if (homeReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!homeReady) throw new Error(`QR entry missing from home at ${viewWidth}x${viewHeight}.`);
    await clickTarget(".a11y-qr-entry-dock-button");
    let modalReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      modalReady = await evaluate("Boolean(document.querySelector('.qr-modal .qr-manual-toggle'))");
      if (modalReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!modalReady) throw new Error(`QR camera/manual modal failed at ${viewWidth}x${viewHeight}.`);
    const modalWins = await evaluate("Number(getComputedStyle(document.querySelector('.a11y-qr-entry-dock')).zIndex) < Number(getComputedStyle(document.querySelector('.modal-backdrop')).zIndex)");
    if (!modalWins) throw new Error(`QR modal is not above the home dock at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('[aria-label=\"설정 불러오기 닫기\"]').click()");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const closed = await evaluate("!document.querySelector('.qr-modal')");
      if (closed) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const dockReturned = await evaluate("Boolean(document.querySelector('.a11y-qr-entry-dock-button'))");
    if (!dockReturned) throw new Error(`QR dock did not return after closing its modal at ${viewWidth}x${viewHeight}.`);
    await clickTarget(".demo-entry-button");
    let profileApplied = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      profileApplied = await evaluate(`(() => {
        const root = document.querySelector(".kiosk");
        const panel = document.querySelector(".a11y-guide-toast");
        const page = panel?.querySelector("[data-a11y-guide-page]")?.textContent ?? "";
        return {
          active: Boolean(document.querySelector(".demo-experience-strip")),
          classes: ["a11y-text-extra","a11y-controls-large","a11y-high-contrast","a11y-easy-language","a11y-bottom-viewport-enabled"].every((name) => root?.classList.contains(name)),
          page,
          text: panel?.innerText ?? "",
          shellHeight: document.querySelector(".shell")?.getBoundingClientRect().height ?? 0,
          viewportHeight: innerHeight,
          expectedShellHeight: Math.floor((innerHeight -
            (Number.parseFloat(root?.style.getPropertyValue("--a11y-bottom-viewport-bottom-inset") ?? "0") || 0)) * 0.6),
        };
      })()`);
      if (profileApplied.active && profileApplied.classes && profileApplied.page === "1/2") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!profileApplied?.active || !profileApplied.classes || profileApplied.page !== "1/2" ||
      Math.abs(profileApplied.shellHeight - profileApplied.expectedShellHeight) > 2) {
      throw new Error(`The fixed v4 accessibility experience did not apply the real SDK profile at ${viewWidth}x${viewHeight}: ${JSON.stringify(profileApplied)}`);
    }
    await evaluate("document.querySelector('[data-a11y-guide-next]').click()");
    if (await evaluate("document.querySelector('[data-a11y-guide-page]')?.textContent") !== "2/2") {
      throw new Error(`Easy-language next page failed at ${viewWidth}x${viewHeight}.`);
    }
    await evaluate("document.querySelector('[data-a11y-guide-previous]').click()");
    await evaluate("document.querySelector('[data-a11y-guide-next]').click()");
    await evaluate("document.querySelector('[data-a11y-guide-collapse]').click()");
    if (viewWidth === 320 && percent === 60) {
      const timerStarted = await evaluate("performance.now()");
      let smartGuideVisible = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        smartGuideVisible = await evaluate(`(() => {
          const panel = document.querySelector(".a11y-guide-toast");
          return { countdown: panel?.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
            collapsed: panel?.classList.contains("a11y-guide-collapsed") ?? false };
        })()`);
        if (smartGuideVisible.countdown.includes("15")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const guideDelayMs = await evaluate(`performance.now() - ${timerStarted}`);
      if (!smartGuideVisible?.countdown.includes("15") || !smartGuideVisible.collapsed ||
        guideDelayMs < 9_500 || guideDelayMs > 12_000) {
        throw new Error(`Smart Guide did not start folded after the 10-second delay at ${viewWidth}x${viewHeight}: ${JSON.stringify({ guideDelayMs, smartGuideVisible })}`);
      }
      const visibleAt = await evaluate("performance.now()");
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const countdownAfter = await evaluate("document.querySelector('[data-a11y-guide-countdown]')?.textContent ?? ''");
      if (Number.parseInt(countdownAfter, 10) >= 15) throw new Error(`Smart Guide countdown did not decrease: ${countdownAfter}`);
      let returnedEasy = null;
      for (let attempt = 0; attempt < 165; attempt += 1) {
        returnedEasy = await evaluate(`(() => {
          const panel = document.querySelector(".a11y-guide-toast");
          return {
            countdown: panel?.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
            page: panel?.querySelector("[data-a11y-guide-page]")?.textContent ?? "",
            collapsed: panel?.classList.contains("a11y-guide-collapsed") ?? false,
          };
        })()`);
        if (!returnedEasy.countdown) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const guideVisibleMs = await evaluate(`performance.now() - ${visibleAt}`);
      if (returnedEasy?.page !== "2/2" || !returnedEasy.collapsed ||
        guideVisibleMs < 14_300 || guideVisibleMs > 16_500) {
        throw new Error(`Slow Guide did not restore folded easy-language page 2/2 after 15 seconds: ${JSON.stringify({ guideVisibleMs, returnedEasy })}`);
      }
    }
    if (viewWidth === 390 && percent === 70) {
      await clickTarget(".demo-experience-strip button");
      let reset = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        reset = await evaluate(`(() => {
          const root = document.querySelector(".kiosk");
          return !document.querySelector(".demo-experience-strip") &&
            !root.classList.contains("a11y-text-extra") &&
            !root.classList.contains("a11y-controls-large") &&
            !root.classList.contains("a11y-high-contrast") &&
            !root.classList.contains("a11y-bottom-viewport-enabled");
        })()`);
        if (reset) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!reset || !(await evaluate("Boolean(document.querySelector('.demo-entry-button'))"))) {
        throw new Error(`Explicit experience exit did not restore the default screen at ${viewWidth}x${viewHeight}.`);
      }
      await clickTarget(".demo-entry-button");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const reapplied = await evaluate(`["a11y-text-extra","a11y-controls-large","a11y-high-contrast","a11y-bottom-viewport-enabled"].every((name) => document.querySelector(".kiosk").classList.contains(name))`);
      if (!reapplied) throw new Error(`Experience could not be started again at ${viewWidth}x${viewHeight}.`);
    }
    await clickTarget("#start-store");
    let menuReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      menuReady = await evaluate("Boolean(document.querySelector('.section-heading') && !document.querySelector('.a11y-qr-entry-dock'))");
      if (menuReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!menuReady) throw new Error(`Menu transition did not hide the home QR dock at ${viewWidth}x${viewHeight}.`);
    const orderViewportHeight = await evaluate("document.querySelector('.shell').getBoundingClientRect().height");
    if (Math.abs(orderViewportHeight - viewHeight * 0.6) > 2) {
      throw new Error(`Order viewport did not use the profile's 60% at ${viewWidth}x${viewHeight}: ${orderViewportHeight}px.`);
    }
    await clickTarget("#menu-product-0");
    let optionReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      optionReady = await evaluate("Boolean(document.querySelector('#item-add'))");
      if (optionReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!optionReady) {
      const state = await evaluate(`(() => ({
        heading: document.querySelector(".section-heading h2")?.textContent ?? "",
        product: document.querySelector("#menu-product-0")?.getAttribute("aria-label") ?? "",
        page: document.querySelector(".page-heading h2")?.textContent ?? "",
        interactions: document.querySelector(".kiosk")?.getAttribute("data-interactions"),
        guide: document.querySelector(".a11y-guide-toast")?.innerText ?? "",
      }))()`);
      throw new Error(`Menu selection/options failed at ${viewWidth}x${viewHeight}: ${JSON.stringify(state)}`);
    }
    await clickTarget(".back-button");
    let backReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      backReady = await evaluate("Boolean(document.querySelector('#menu-product-0'))");
      if (backReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!backReady) throw new Error(`Back from options did not restore menu at ${viewWidth}x${viewHeight}.`);
    await clickTarget("#menu-product-0");
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      optionReady = await evaluate("Boolean(document.querySelector('#item-add'))");
      if (optionReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!optionReady) {
      await evaluate("document.querySelector('#menu-product-0')?.click()");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        optionReady = await evaluate("Boolean(document.querySelector('#item-add'))");
        if (optionReady) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!optionReady) {
      const state = await evaluate(`({
        heading: document.querySelector(".section-heading h2")?.textContent ?? "",
        product: document.querySelector("#menu-product-0")?.getAttribute("aria-label") ?? "",
        stage: document.querySelector("#item-add") ? "options" : "menu",
      })`);
      throw new Error(`Reopening options after Back failed at ${viewWidth}x${viewHeight}: ${JSON.stringify(state)}`);
    }
    await clickTarget("#item-add");
    let confirmReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      confirmReady = await evaluate("Boolean(document.querySelector('#menu-order-confirm'))");
      if (confirmReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!confirmReady) throw new Error(`Adding the menu item failed at ${viewWidth}x${viewHeight}.`);
    await clickTarget("#menu-order-confirm");
    let cartReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      cartReady = await evaluate("Boolean(document.querySelector('#cart-pay'))");
      if (cartReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!cartReady) throw new Error(`Cart screen failed at ${viewWidth}x${viewHeight}.`);
    await clickTarget("#cart-pay");
    let paymentReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      paymentReady = await evaluate("Boolean(document.querySelector('#payment-pay'))");
      if (paymentReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!paymentReady) throw new Error(`Payment screen failed at ${viewWidth}x${viewHeight}.`);
    await clickTarget("#payment-pay");
    let completeReady = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      completeReady = await evaluate("Boolean(document.querySelector('#complete-reset'))");
      if (completeReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!completeReady) throw new Error(`Demo payment completion failed at ${viewWidth}x${viewHeight}.`);
    const receiptChoiceReady = await evaluate("Boolean(document.querySelector('.receipt-actions button'))");
    if (!receiptChoiceReady) throw new Error(`Receipt choice missing at ${viewWidth}x${viewHeight}.`);
    await clickTarget(".receipt-actions button");
    const receiptResult = await evaluate("document.querySelector('.receipt-result')?.innerText ?? ''");
    if (!receiptResult.includes("준비했어요")) throw new Error(`Receipt selection failed: ${receiptResult}`);
    if (viewWidth === 320 && structure === "long-menu" && percent === 60) {
      const started = await evaluate("performance.now()");
      let resetReady = false;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        resetReady = await evaluate("Boolean(document.querySelector('#start-store') && document.querySelector('.a11y-qr-entry-dock-button'))");
        if (resetReady) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      completionAutoReturnMs = await evaluate(`performance.now() - ${started}`);
      if (!resetReady || completionAutoReturnMs < 14_000 || completionAutoReturnMs > 18_000) {
        throw new Error(`Timed completion auto-return failed (${completionAutoReturnMs}ms) at ${viewWidth}x${viewHeight}.`);
      }
    } else {
      await clickTarget("#complete-reset");
      let resetReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        resetReady = await evaluate("Boolean(document.querySelector('#start-store') && document.querySelector('.a11y-qr-entry-dock-button'))");
        if (resetReady) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!resetReady) throw new Error(`Completion reset did not restore the home QR dock at ${viewWidth}x${viewHeight}.`);
    }
    }
    await send("Page.navigate", {
      url: `http://127.0.0.1:5000/qr-entry-area-poc.html?structure=${structure}&percent=${percent}`,
    });
    let result;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      result = await evaluate("window.qrEntryPocResult || null");
      if (result) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!result) throw new Error(`QR entry fixture did not finish for ${viewWidth}x${viewHeight} (${structure}).`);
    reports.push({ viewport: `${viewWidth}x${viewHeight}`, percent, ...result, completionAutoReturnMs });
  } finally {
    try { socket?.close(); } catch {}
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  }
}

console.log(JSON.stringify(reports, null, 2));
if (reports.length !== 28 || reports.some((report) => !report.pass)) {
  throw new Error("QR entry PoC browser verification failed.");
}
console.log(JSON.stringify({ sdkGuideObstructionsDuringRealOrder: guideObstructions }, null, 2));
