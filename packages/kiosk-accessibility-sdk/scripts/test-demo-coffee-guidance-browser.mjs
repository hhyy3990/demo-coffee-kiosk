import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const viewportWidth = Number(process.env.GUIDANCE_WIDTH || 390);
const viewportHeight = Number(process.env.GUIDANCE_HEIGHT || 844);
const port = 49300 + (process.pid % 500);
const debugPort = port + 500;
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/demo-coffee-guidance-${process.pid}`,
  "about:blank",
], { stdio: "ignore", detached: true });

let socket;
try {
  let target;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((entry) => entry.type === "page");
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
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = async (selector) => {
    const point = await evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      target?.scrollIntoView({ block: "center", behavior: "instant" });
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const panelRect = document.querySelector(".a11y-guide-toast")?.getBoundingClientRect();
      return { x, y, visible: rect.width > 0 && rect.height > 0 &&
        rect.top >= 0 && rect.bottom <= innerHeight, hit: hit === target || target.contains(hit),
        hitElement: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className) } : null,
        targetRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        panelRect: panelRect ? { left: panelRect.left, top: panelRect.top,
          right: panelRect.right, bottom: panelRect.bottom } : null };
    })()`);
    if (!point?.visible || !point.hit) {
      throw new Error(`Actual hit-test failed for ${selector}: ${JSON.stringify(point)}`);
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
    });
    await wait(120);
  };
  const read = () => evaluate(`(() => {
    const panel = document.querySelector(".a11y-guide-toast");
    if (!panel) return { exists: false, visible: false };
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    const primary = [...document.querySelectorAll("[data-a11y-primary='true']")];
    const visibleRect = (element) => {
      const r = element.getBoundingClientRect();
      let left = Math.max(0, r.left), top = Math.max(0, r.top);
      let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
          left = Math.max(left, clip.left); right = Math.min(right, clip.right);
        }
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
          top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
        }
        if (right <= left || bottom <= top) return null;
      }
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    };
    const overlaps = (a, b) => a.left < b.right && a.right > b.left &&
      a.top < b.bottom && a.bottom > b.top;
    const panelVisible = panel.isConnected && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity) > 0 &&
      rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
    const textElement = panel.querySelector("[data-a11y-guide-text]");
    const pageElement = panel.querySelector("[data-a11y-guide-page]");
    return {
      exists: panel.isConnected,
      visible: panelVisible,
      hitTest: panelVisible && panel.contains(hit),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height },
      ariaHidden: panel.getAttribute("aria-hidden"),
      suppressed: panel.dataset.a11yPositionSuppressed === "true",
      title: panel.querySelector("[data-a11y-guide-title]")?.textContent ?? "",
      text: textElement?.textContent ?? "",
      textVisible: Boolean(textElement && textElement.getClientRects().length &&
        getComputedStyle(textElement).display !== "none" && getComputedStyle(textElement).visibility !== "hidden"),
      page: pageElement?.textContent ?? "",
      pageVisible: Boolean(pageElement && pageElement.getClientRects().length &&
        getComputedStyle(pageElement).display !== "none" && getComputedStyle(pageElement).visibility !== "hidden"),
      pagerHidden: panel.querySelector("[data-a11y-guide-pager]")?.hidden ?? true,
      previousHidden: panel.querySelector("[data-a11y-guide-previous]")?.hidden ?? true,
      nextHidden: panel.querySelector("[data-a11y-guide-next]")?.hidden ?? true,
      countdown: panel.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
      collapsed: panel.classList.contains("a11y-guide-collapsed"),
      primaryOverlaps: primary.filter((button) => {
        const r = visibleRect(button);
        return r && overlaps(rect, r);
      })
        .map((button) => button.id || button.textContent?.trim()),
      primaryActions: primary.map((button) => {
        const r = button.getBoundingClientRect();
        const visible = visibleRect(button);
        const x = visible ? visible.left + (visible.right - visible.left) / 2 : 0;
        const y = visible ? visible.top + (visible.bottom - visible.top) / 2 : 0;
        const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
          ? document.elementFromPoint(x, y) : null;
        return { id: button.id, label: button.textContent?.trim(), top: r.top, bottom: r.bottom,
          centerHit: hit === button || button.contains(hit),
          visibleInViewport: Boolean(visible) };
      }),
      scrollOwner: (() => {
        const el = document.querySelector('[data-a11y-slot="scroll-content"]');
        return el ? { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
          scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          overflowY: getComputedStyle(el).overflowY } : null;
      })(),
    };
  })()`);
  const assertVisible = async (label, expectedTitle) => {
    const state = await read();
    console.log(JSON.stringify({ label, ...state }));
    if (!state.exists || !state.visible || !state.hitTest || state.ariaHidden === "true" ||
      state.suppressed || state.primaryOverlaps.length ||
      (expectedTitle && state.title !== expectedTitle)) {
      throw new Error(`${label}: guidance is not visibly and safely presented: ${JSON.stringify(state)}`);
    }
    return state;
  };
  const scrollTenTimes = async (label) => {
    const before = await read();
    for (let index = 0; index < 10; index += 1) {
      const point = await evaluate(`(() => {
        const el = document.querySelector('[data-a11y-slot="scroll-content"]');
        if (!el) return null;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const rect = el.getBoundingClientRect();
        return { x: rect.right - 8, y: Math.min(rect.bottom - 12, rect.top + 50),
          deltaY: el.scrollTop >= max - 2 ? -90 : 90 };
      })()`);
      if (!point) throw new Error(`${label}: scroll owner was not found.`);
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: point.deltaY,
      });
      await wait(75);
      const state = await read();
      if (!state.exists || !state.visible || !state.hitTest || state.ariaHidden !== "false" ||
        state.suppressed || state.primaryOverlaps.length || state.title !== before.title ||
        state.page !== before.page) {
        throw new Error(`${label} scroll ${index + 1} hid or obstructed guidance: ${JSON.stringify(state)}`);
      }
    }
    console.log(JSON.stringify({ label, scrolls: 10, after: await read() }));
  };
  const touchScrollOnce = async () => {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const point = await evaluate(`(() => {
      const rect = document.querySelector('[data-a11y-slot="scroll-content"]').getBoundingClientRect();
      return { x: rect.right - 12, y: Math.min(rect.bottom - 30, rect.top + 150) };
    })()`);
    const before = await evaluate("document.querySelector('[data-a11y-slot=\"scroll-content\"]').scrollTop");
    await send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: point.x, y: point.y }],
    });
    await send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: point.x, y: point.y - 100 }],
    });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(150);
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const after = await evaluate("document.querySelector('[data-a11y-slot=\"scroll-content\"]').scrollTop");
    const state = await assertVisible("options-easy-touch-scroll", "음료 옵션");
    if (after <= before) {
      throw new Error(`A real touch scroll did not move the app scroll owner: ${before} -> ${after}`);
    }
    return { before, after, guidanceStillVisible: state.visible };
  };
  const waitForGuide = async (label) => {
    const started = performance.now();
    let state;
    for (let attempt = 0; attempt < 115; attempt += 1) {
      state = await read();
      if (state.countdown && state.pagerHidden) break;
      await wait(100);
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ label, elapsedMs: Math.round(elapsed), ...state }));
    if (!state?.countdown || !state.text || state.page !== "" || !state.pagerHidden ||
      !state.previousHidden || !state.nextHidden || !state.visible || !state.hitTest ||
      state.primaryOverlaps.length) {
      throw new Error(`${label}: Smart Guide state was incorrect: ${JSON.stringify(state)}`);
    }
    return state;
  };
  const waitForEasy = async (label, expectedTitle, expectedPage) => {
    const started = performance.now();
    let state;
    for (let attempt = 0; attempt < 165; attempt += 1) {
      state = await read();
      if (state.title === expectedTitle) break;
      await wait(100);
    }
    const elapsed = performance.now() - started;
    console.log(JSON.stringify({ label, elapsedMs: Math.round(elapsed), ...state }));
    if (state?.title !== expectedTitle || state.page !== expectedPage || !state.visible ||
      !state.hitTest || state.primaryOverlaps.length) {
      throw new Error(`${label}: Easy Language did not resume correctly: ${JSON.stringify(state)}`);
    }
    return state;
  };

  await send("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: true,
    screenWidth: viewportWidth, screenHeight: viewportHeight,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:5000/" });
  await evaluate(`window.__guidanceLongTasks = [];
    new PerformanceObserver((list) => window.__guidanceLongTasks.push(
      ...list.getEntries().map((entry) => Math.round(entry.duration))
    )).observe({ type: "longtask", buffered: true });`);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ready = await evaluate("Boolean(document.querySelector('.demo-entry-button'))");
    if (ready) break;
    await wait(50);
  }
  if (!ready) throw new Error("Demo Coffee start screen did not load.");
  await click(".demo-entry-button");
  const firstScreen = await read();
  if (firstScreen.exists) throw new Error(`Easy Language unexpectedly appeared on the welcome screen: ${JSON.stringify(firstScreen)}`);
  await click("#start-store");
  await click("#menu-product-0");
  await wait(250);
  const optionEasy = await assertVisible("options-entered", "음료 옵션");
  if (optionEasy.page !== "1/2") throw new Error(`Options Easy Language did not start at 1/2: ${JSON.stringify(optionEasy)}`);
  const touchScroll = await touchScrollOnce();
  await scrollTenTimes("options-easy");
  await waitForGuide("options-smart-start");
  await scrollTenTimes("options-smart");
  await waitForEasy("options-smart-return", "음료 옵션", "1/2");

  await click("#item-add");
  await wait(500);
  const menuScrollPoint = await evaluate(`(() => {
    const rect = document.querySelector('[data-a11y-slot="scroll-content"]').getBoundingClientRect();
    return { x: rect.right - 8, y: rect.top + 48 };
  })()`);
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: menuScrollPoint.x, y: menuScrollPoint.y, deltaX: 0, deltaY: 360,
  });
  await wait(120);
  await click("#menu-order-confirm");
  await wait(250);
  const cartEasy = await assertVisible("cart-entered", "주문 확인");
  if (cartEasy.collapsed) await click("[data-a11y-guide-collapse]");
  await click("[data-a11y-guide-next]");
  const cartPageTwo = await assertVisible("cart-easy-page-two", "결제하기");
  if (cartPageTwo.page !== "2/2") throw new Error(`Cart explanation could not reach page 2/2: ${JSON.stringify(cartPageTwo)}`);
  await scrollTenTimes("cart-easy");
  await waitForGuide("cart-smart-start");
  await scrollTenTimes("cart-smart");
  const cartReturn = await waitForEasy("cart-smart-return", "결제하기", "2/2");
  await click("#cart-pay");
  const payment = await assertVisible("payment-entered", "결제 방법");
  if (payment.page !== "1/2") throw new Error(`Payment Easy Language did not start at 1/2: ${JSON.stringify(payment)}`);
  await click("#payment-pay");
  let completeReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    completeReady = await evaluate("Boolean(document.querySelector('#complete-reset'))");
    if (completeReady) break;
    await wait(100);
  }
  if (!completeReady) throw new Error("The actual demo order did not reach the completion screen.");
  const complete = await assertVisible("order-complete", "주문 완료");
  await click(".receipt-actions button");
  await click("#complete-reset");
  let returnedHome = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    returnedHome = await evaluate("Boolean(document.querySelector('.demo-entry-button'))");
    if (returnedHome) break;
    await wait(100);
  }
  if (!returnedHome) throw new Error("The complete demo order did not return to the welcome screen.");
  console.log(JSON.stringify({
    result: "PASS",
    viewport: `${viewportWidth}x${viewportHeight}`,
    firstScreenPanel: firstScreen.exists,
    optionsPanelImmediatelyVisible: optionEasy.visible,
    cartPanelImmediatelyVisible: cartReturn.visible,
    paymentPanelImmediatelyVisible: payment.visible,
    completionPanelImmediatelyVisible: complete.visible,
    fullDemoOrderFinished: returnedHome,
    smartGuidePagerHidden: true,
    tenEasyAndTenSmartWheelScrollsPerStep: true,
    touchScroll,
    longTasksMs: await evaluate("window.__guidanceLongTasks"),
  }, null, 2));
} finally {
  try { socket?.close(); } catch {}
  if (browser.pid) {
    try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  }
}
