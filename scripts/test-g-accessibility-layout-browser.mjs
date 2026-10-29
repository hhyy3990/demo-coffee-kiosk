import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromiumPath = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const debugPort = 49700 + (process.pid % 150);
const userData = await mkdtemp(join(tmpdir(), "democoffee-g-profile-"));
const browser = spawn(chromiumPath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });
const browserExit = new Promise((resolve) => browser.once("exit", resolve));
let socket;

try {
  let target;
  for (let i = 0; i < 120; i += 1) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`))
        .json()).find((entry) => entry.type === "page");
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(target, "Chromium did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let requestId = 0;
  let protectedApiRequests = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.requestWillBeSent") {
      const url = new URL(message.params.request.url);
      if (/\/api\/(ai-layout|qr-profile|dev\/universal-layout)(\/|$)/.test(url.pathname)) {
        protectedApiRequests += 1;
      }
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate, label) => {
    for (let i = 0; i < 120; i += 1) {
      if (await evaluate(predicate)) return;
      await wait(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const clickAt = async ({ x, y }) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  const cases = [
    { profile: "A", query: "standard", expectedClasses: [] },
    {
      profile: "G",
      query: "large-text-buttons-contrast-bottom-simple-guide-scroll",
      expectedClasses: [
        "a11y-text-large", "a11y-controls-large", "a11y-high-contrast",
        "a11y-easy-language", "a11y-bottom-controls",
      ],
    },
  ];
  const results = [];

  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*"] });
  await send("Page.enable");

  for (const testCase of cases) {
    for (const width of [360, 390]) {
      try { await evaluate("sessionStorage.clear()"); } catch {}
      await send("Emulation.setDeviceMetricsOverride", {
        width, height: 844, deviceScaleFactor: 1, mobile: false,
        screenWidth: width, screenHeight: 844,
      });
      const sdkViewport = testCase.profile === "G" ? "&bottom-sdk=70" : "";
      const query = `?poc-profile=${testCase.query}${sdkViewport}`;
      await send("Page.navigate", { url: `${appUrl}/${query}` });
      await until("Boolean(document.querySelector('#start-store'))", "welcome screen");
      await until("Boolean(document.querySelector('[data-a11y-qr-entry-dock]'))", "QR entry dock");
      const startState = await evaluate(`(() => {
        const root = document.querySelector('.kiosk');
        const dock = document.querySelector('[data-a11y-qr-entry-dock]');
        const button = dock?.querySelector('button');
        return {
          classes: Array.from(root.classList),
          dockHeight: dock?.getBoundingClientRect().height ?? 0,
          dockButtonHeight: button?.getBoundingClientRect().height ?? 0,
          dockVisible: Boolean(dock && getComputedStyle(dock).display !== 'none'),
        };
      })()`);
      assert.equal(startState.dockVisible, true);
      assert.ok(startState.dockButtonHeight >= 44, `${testCase.profile}/${width}px QR target`);
      for (const className of testCase.expectedClasses) {
        assert.ok(startState.classes.includes(className), `${testCase.profile} missing ${className}`);
      }

      await evaluate("document.querySelector('#start-store').click()");
      await until("Boolean(document.querySelector('#menu-product-4'))", "menu session");
      if (testCase.profile === "G") {
        await until(
          "document.querySelector('.kiosk')?.classList.contains('a11y-bottom-viewport-enabled')",
          "70% bottom viewport",
        );
      }
      const initialMenu = await evaluate(`(() => ({
        ids: Array.from(document.querySelectorAll('.product-card')).map(card => card.dataset.menuProductId),
        profile: Array.from(document.querySelector('.kiosk').classList),
        scrollArea: document.querySelector('.a11y-bottom-viewport-scroll-area') ? 'sdk' : 'document',
        smartGuide: Boolean(document.querySelector('.smart-guide-status')),
      }))()`);
      assert.equal(initialMenu.ids.length, 5);
      assert.deepEqual(initialMenu.ids, ["americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea"]);
      if (testCase.profile === "G") {
        assert.equal(initialMenu.smartGuide, true);
        await until(
          `Boolean(document.querySelector('.a11y-additional-menu-hint')) &&
            document.querySelector('.a11y-additional-menu-hint').getAttribute('aria-hidden') !== 'true'`,
          "scroll guidance hint",
        );
      }

      // Exercise the real menu-to-options-to-cart path before measuring the sticky bar.
      const firstProduct = await evaluate(`(() => {
        const button = document.querySelector('#menu-product-4');
        button.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, height: rect.height };
      })()`);
      assert.ok(firstProduct.height >= 44);
      await clickAt(firstProduct);
      await until("Boolean(document.querySelector('#item-add'))", "product options");
      await evaluate(`(() => {
        const option = Array.from(document.querySelectorAll('.pill-option'))
          .find(button => button.textContent.includes('차갑게'));
        if (option) option.click();
      })()`);
      const optionSelected = await evaluate(
        `Array.from(document.querySelectorAll('.pill-option')).some(button => button.textContent.includes('차갑게') && button.classList.contains('selected'))`,
      );
      assert.equal(optionSelected, true, "temperature option remains selectable");
      await evaluate("document.querySelector('#item-add').click()");
      await until("Boolean(document.querySelector('.cart-bar'))", "cart bar");

      const atBottom = await evaluate(`(() => {
        const area = document.querySelector('.a11y-bottom-viewport-scroll-area') ||
          document.scrollingElement;
        area.scrollTop = area.scrollHeight;
        const button = document.querySelector('#menu-product-4');
        const card = button.closest('.product-card');
        const bar = document.querySelector('.cart-bar');
        const cardRect = card.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const hit = document.elementFromPoint(
          buttonRect.left + buttonRect.width / 2,
          buttonRect.top + buttonRect.height / 2,
        );
        return {
          productCount: document.querySelectorAll('.product-card').length,
          scrollTop: area.scrollTop,
          scrollHeight: area.scrollHeight,
          clientHeight: area.clientHeight,
          barPosition: getComputedStyle(bar).position,
          barHeight: barRect.height,
          cardTop: cardRect.top,
          cardBottom: cardRect.bottom,
          barTop: barRect.top,
          barBottom: barRect.bottom,
          overlaps: cardRect.left < barRect.right && cardRect.right > barRect.left &&
            cardRect.top < barRect.bottom && cardRect.bottom > barRect.top,
          buttonHeight: buttonRect.height,
          buttonCenterHit: hit === button || button.contains(hit),
          buttonCenterX: buttonRect.left + buttonRect.width / 2,
          buttonCenterY: buttonRect.top + buttonRect.height / 2,
          documentWidth: document.documentElement.scrollWidth,
        };
      })()`);
      assert.equal(atBottom.productCount, 5);
      assert.ok(atBottom.scrollHeight > atBottom.clientHeight, `${testCase.profile}/${width}px scrolls`);
      assert.equal(
        atBottom.overlaps, false,
        `${testCase.profile}/${width}px card/cart overlap: ${JSON.stringify(atBottom)}`,
      );
      assert.equal(
        atBottom.buttonCenterHit, true,
        `${testCase.profile}/${width}px last product hit: ${JSON.stringify(atBottom)}`,
      );
      assert.ok(atBottom.buttonHeight >= 44);
      assert.ok(atBottom.documentWidth <= width);

      await clickAt({ x: atBottom.buttonCenterX, y: atBottom.buttonCenterY });
      await wait(150);
      const secondActionState = await evaluate(`(() => ({
        optionsVisible: Boolean(document.querySelector('#item-add')),
        heading: document.querySelector('.eyebrow')?.textContent ?? null,
        interactions: document.querySelector('.kiosk')?.dataset.interactions ?? null,
      }))()`);
      assert.equal(
        secondActionState.optionsVisible, true,
        `last product click did not open options: ${JSON.stringify({ atBottom, secondActionState })}`,
      );
      await evaluate("document.querySelector('#item-add').click()");
      await until(
        "document.querySelector('.cart-bar')?.textContent.includes('2개 담았어요')",
        "cart updates after second item",
      );
      await evaluate("document.querySelector('#menu-order-confirm').click()");
      await until("document.querySelectorAll('.cart-item').length === 2", "cart review");
      const cartItems = await evaluate("document.querySelectorAll('.cart-item').length");
      assert.equal(cartItems, 2);

      await evaluate(`document.querySelector('.page-heading .back-button')?.click()`);
      await until("Boolean(document.querySelector('.product-grid'))", "return to menu");
      await evaluate("document.querySelector('.bottom-actions .back-button').click()");
      await until("Boolean(document.querySelector('#start-store'))", "end accessibility session");
      await until("Boolean(document.querySelector('[data-a11y-qr-entry-dock]'))", "QR dock after reset");
      assert.equal(await evaluate("document.querySelector('.cart-bar') === null"), true);

      results.push({
        profile: testCase.profile,
        width,
        productOrder: initialMenu.ids,
        qrDockButtonHeight: startState.dockButtonHeight,
        cartBarHeight: atBottom.barHeight,
        cartBarPosition: atBottom.barPosition,
        overlap: atBottom.overlaps,
        lastProductHit: atBottom.buttonCenterHit,
        optionsSelectable: optionSelected,
        cartLines: cartItems,
        sessionReset: true,
      });
    }
  }

  assert.equal(protectedApiRequests, 0, "no QR, central, AI, or relay endpoint was called");
  console.log(JSON.stringify({ results, protectedApiRequests }, null, 2));
} finally {
  socket?.close();
  try { process.kill(-browser.pid, "SIGTERM"); } catch {}
  await Promise.race([
    browserExit,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
