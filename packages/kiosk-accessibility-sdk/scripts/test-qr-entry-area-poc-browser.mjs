import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const scenarios = [
  { viewport: [320, 844], structure: "fixed-controls", percent: 60 },
  { viewport: [390, 844], structure: "fixed-controls", percent: 70 },
  { viewport: [1080, 1920], structure: "fixed-controls", percent: 80 },
];
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
    const clickTarget = async (selector, mayDismissGuide = true, scrollAttempts = 0) => {
      const point = await evaluate(`(async () => {
        const initialTarget = document.querySelector(${JSON.stringify(selector)});
        if (!initialTarget) return null;
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return null;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const guideRect = document.querySelector(".a11y-guide-toast")?.getBoundingClientRect();
        const scrollOwner = document.querySelector('[data-a11y-slot="scroll-content"]');
        return {
          x, y, visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
          hit: hit === target || target.contains(hit),
          hitElement: hit ? [hit.tagName.toLowerCase(), hit.id, String(hit.className)].join("|") : "none",
          targetRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          guideRect: guideRect ? { top: guideRect.top, bottom: guideRect.bottom, left: guideRect.left, right: guideRect.right } : null,
          scrollOwner: scrollOwner ? {
            left: scrollOwner.getBoundingClientRect().left,
            right: scrollOwner.getBoundingClientRect().right,
            top: scrollOwner.getBoundingClientRect().top,
            bottom: scrollOwner.getBoundingClientRect().bottom,
            clientHeight: scrollOwner.clientHeight,
            scrollHeight: scrollOwner.scrollHeight,
            scrollTop: scrollOwner.scrollTop,
            overflowY: getComputedStyle(scrollOwner).overflowY,
          } : null,
          documentScroll: { top: document.scrollingElement?.scrollTop ?? 0,
            height: document.scrollingElement?.scrollHeight ?? 0,
            clientHeight: document.scrollingElement?.clientHeight ?? 0 },
        };
      })()`);
      const outsideScrollArea = point?.scrollOwner &&
        (point.targetRect.bottom <= point.scrollOwner.top || point.targetRect.top >= point.scrollOwner.bottom);
      if ((!point?.visible || outsideScrollArea || !point.hit) && scrollAttempts < 3 &&
        point?.scrollOwner?.overflowY === "auto") {
        const x = Math.max(point.scrollOwner.left + 1, point.scrollOwner.right - 4);
        const y = (point.scrollOwner.top + point.scrollOwner.bottom) / 2;
        const deltaY = point.targetRect.top + (point.targetRect.bottom - point.targetRect.top) / 2 -
          (point.scrollOwner.top + point.scrollOwner.clientHeight / 2);
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
        await new Promise((resolve) => setTimeout(resolve, 80));
        return clickTarget(selector, mayDismissGuide, scrollAttempts + 1);
      }
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
      await new Promise((resolve) => setTimeout(resolve, 80));
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
    await new Promise((resolve) => setTimeout(resolve, 250));
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
if (reports.length !== scenarios.length || reports.some((report) => !report.pass)) {
  throw new Error("QR entry PoC browser verification failed.");
}
console.log(JSON.stringify({ sdkGuideObstructionsDuringRealOrder: guideObstructions }, null, 2));
