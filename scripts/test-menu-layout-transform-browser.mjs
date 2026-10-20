import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const debugPort = 49100 + (process.pid % 500);
const userData = await mkdtemp(join(tmpdir(), "democoffee-menu-layout-"));
const browser = spawn(chromium, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
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

  let nextId = 0;
  const pending = new Map();
  const aiLayoutRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.requestWillBeSent") {
      try {
        if (new URL(message.params.request.url).pathname === "/api/ai-layout/plan") {
          aiLayoutRequests.push(message.params.request.url);
        }
      } catch {}
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args ?? [])
        .map((argument) => argument.value ?? argument.description ?? "")
        .join(" ");
      if (text.includes("menu layout rejected")) console.log(text);
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  };
  await send("Runtime.enable");
  await send("Network.enable");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (expression, label, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(50);
    }
    const state = await evaluate(`({
      url: location.href,
      hasStart: Boolean(document.querySelector("#start-store")),
      hasMenuGrid: Boolean(document.querySelector(".product-grid")),
      body: document.body.innerText.slice(0, 500)
    })`);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
  };
  const click = async (selector) => {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Missing clickable element: ${selector}`);
    await wait(100);
  };

  const readMenu = () => evaluate(`(() => {
    const grid = document.querySelector(".product-grid");
    const cards = [...(grid?.querySelectorAll(".product-card") ?? [])];
    const first = cards[0];
    const button = first?.querySelector("button");
    const image = first?.querySelector(".product-art")?.getBoundingClientRect();
    const info = first?.querySelector(".product-meta")?.getBoundingClientRect();
    const card = first?.getBoundingClientRect();
    const semanticIds = {
      category: document.querySelector(".category-nav")?.dataset.menuLayoutId,
      list: grid?.dataset.menuLayoutId,
      card: first?.dataset.menuLayoutId,
      action: button?.dataset.menuLayoutId,
      image: first?.querySelector(".product-art")?.dataset.menuLayoutId,
      information: first?.querySelector(".product-meta")?.dataset.menuLayoutId,
      name: first?.querySelector('[data-menu-layout-id="menu.product-name"]')?.dataset.menuLayoutId,
      price: first?.querySelector(".price")?.dataset.menuLayoutId,
      description: first?.querySelector(".optional-detail")?.dataset.menuLayoutId,
      fixedControls: document.querySelector(".bottom-actions")?.dataset.menuLayoutId,
    };
    const visibleText = [...(grid?.querySelectorAll(".product-korean, .price") ?? [])];
    return {
      stage: document.querySelector(".section-heading h2")?.textContent?.trim() ?? null,
      semanticIds,
      columns: grid?.dataset.aiColumns ?? "default",
      cardFlow: grid?.dataset.aiCardFlow ?? "default",
      computedColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      cardCount: cards.length,
      itemIndexes: cards.map((item) => item.dataset.menuIndex),
      ariaLabels: cards.map((item) => item.querySelector("button")?.getAttribute("aria-label")),
      imageRect: image ? { left: image.left, right: image.right, top: image.top, bottom: image.bottom, width: image.width, height: image.height } : null,
      infoRect: info ? { left: info.left, right: info.right, top: info.top, bottom: info.bottom, width: info.width, height: info.height } : null,
      cardRect: card ? { left: card.left, right: card.right, top: card.top, bottom: card.bottom, width: card.width, height: card.height } : null,
      firstButtonTarget: button ? { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height } : null,
      textClipping: visibleText.some((element) =>
        element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      scrollHintCount: document.querySelectorAll(".a11y-additional-menu-hint").length,
      easyPanelCount: document.querySelectorAll(".a11y-guide-toast").length,
    };
  })()`);

  const openMenu = async (width, height, query = "") => {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height,
    });
    await send("Page.navigate", { url: `${appUrl}/${query}` });
    await waitFor("Boolean(document.querySelector('#start-store'))", "welcome screen");
    if (query.includes("poc-profile=")) {
      await waitFor(
        "document.querySelector('.kiosk')?.classList.contains('a11y-text-large')",
        "large-text development profile",
      );
    }
    await click("#start-store");
    await waitFor("Boolean(document.querySelector('.product-grid .product-card'))", "menu screen");
    await wait(350);
  };

  const sizes = [[360, 667], [390, 844]];
  for (const [width, height] of sizes) {
    await openMenu(width, height);
    const baseline = await readMenu();
    if (baseline.columns !== "default" || baseline.cardFlow !== "default") {
      throw new Error(`Unexpected baseline layout at ${width}px.`);
    }
    if (baseline.cardCount < 1 || baseline.horizontalOverflow || baseline.textClipping) {
      throw new Error(`Baseline menu has an accessibility issue at ${width}px: ${JSON.stringify(baseline)}`);
    }

    await openMenu(width, height, "?mockAiLayout=menu-row");
    const transformed = await readMenu();
    if (transformed.columns !== "1" || transformed.cardFlow !== "row" ||
        transformed.computedColumns !== 1) {
      throw new Error(`Validated mock plan was not applied at ${width}px.`);
    }
    if (transformed.cardCount !== baseline.cardCount ||
        JSON.stringify(transformed.itemIndexes) !== JSON.stringify(baseline.itemIndexes) ||
        JSON.stringify(transformed.ariaLabels) !== JSON.stringify(baseline.ariaLabels)) {
      throw new Error(`The plan changed menu items or their order at ${width}px.`);
    }
    const expectedSemanticIds = {
      category: "menu.category-navigation",
      list: "menu.product-list",
      card: "menu.product-card",
      action: "menu.product-action",
      image: "menu.product-image",
      information: "menu.product-information",
      name: "menu.product-name",
      price: "menu.product-price",
      description: "menu.product-description",
      fixedControls: "menu.fixed-controls",
    };
    if (JSON.stringify(transformed.semanticIds) !== JSON.stringify(expectedSemanticIds)) {
      throw new Error(`Semantic IDs are not bound to the intended React elements: ${JSON.stringify(transformed.semanticIds)}`);
    }
    if (transformed.imageRect.right > transformed.infoRect.left + 1 ||
        transformed.horizontalOverflow || transformed.textClipping) {
      throw new Error(`Transformed menu overlaps or clips content at ${width}px: ${JSON.stringify(transformed)}`);
    }
    if (width === 390 && transformed.imageRect.top > baseline.imageRect.top + 30) {
      throw new Error("The 390px mock plan did not visibly change the vertical card layout.");
    }
    if (width === 360 && transformed.imageRect.height >= baseline.imageRect.height - 8) {
      throw new Error("The compact mock plan did not visibly change the card's image/content proportions.");
    }
    console.log(JSON.stringify({ width, height, baseline, transformed }));

    // Existing menu click, option selection, cart, and payment flow stay host-owned.
    await click("#menu-product-0");
    await waitFor("Boolean(document.querySelector('#item-add'))", "menu options");
    if (await evaluate("Boolean(document.querySelector('[data-ai-columns], [data-ai-card-flow]'))")) {
      throw new Error("The menu plan remained active after leaving the menu screen.");
    }
    const optionButton = await evaluate(`(() => [...document.querySelectorAll(".pill-option")]
      .find((button) => button.textContent.includes("차갑게"))?.className ?? "")()`);
    if (!optionButton) throw new Error("Menu options did not render.");
    await click(".option-group .pill-option:nth-child(2)");
    await click("#item-add");
    await waitFor("Boolean(document.querySelector('#menu-order-confirm'))", "menu after adding an item");
    if (await evaluate("Boolean(document.querySelector('[data-ai-columns], [data-ai-card-flow]'))")) {
      throw new Error("Returning to the menu re-applied a stale mock plan.");
    }
    await click("#menu-order-confirm");
    await waitFor("Boolean(document.querySelector('#cart-pay'))", "cart screen");
    await click("#cart-pay");
    await waitFor("Boolean(document.querySelector('#payment-pay'))", "payment screen");
    await click("#payment-pay");
    await waitFor("Boolean(document.querySelector('#complete-reset'))", "order completion");
    await click("#complete-reset");
    await waitFor("Boolean(document.querySelector('#start-store'))", "session reset");
  }

  // Column count and card-internal flow are independently selectable.
  await openMenu(390, 844, "?mockAiLayout=columns-only");
  const columnsOnly = await readMenu();
  if (columnsOnly.columns !== "1" || columnsOnly.computedColumns !== 1 ||
      columnsOnly.cardFlow !== "default" ||
      columnsOnly.imageRect.bottom > columnsOnly.infoRect.top + 1) {
    throw new Error(`Column-only plan also changed card internals or failed to reflow: ${JSON.stringify(columnsOnly)}`);
  }

  await openMenu(360, 667, "?mockAiLayout=card-only");
  const cardOnly = await readMenu();
  if (cardOnly.columns !== "default" || cardOnly.cardFlow !== "row" ||
      cardOnly.computedColumns !== 1 ||
      cardOnly.imageRect.right > cardOnly.infoRect.left + 1 ||
      cardOnly.imageRect.width >= 90 ||
      cardOnly.infoRect.left - cardOnly.imageRect.right < 11) {
    throw new Error(`Card-only plan changed list columns or failed to reflow: ${JSON.stringify(cardOnly)}`);
  }

  await openMenu(360, 667, "?mockAiLayout=columns-2");
  const rejectedCompactColumns = await readMenu();
  if (rejectedCompactColumns.columns !== "default" ||
      rejectedCompactColumns.computedColumns !== 1 ||
      rejectedCompactColumns.cardFlow !== "default") {
    throw new Error(`Unsafe two-column compact plan was not rejected: ${JSON.stringify(rejectedCompactColumns)}`);
  }

  await openMenu(390, 844, "?mockAiLayout=columns-2");
  const twoColumns = await readMenu();
  if (twoColumns.columns !== "2" || twoColumns.computedColumns !== 2 ||
      twoColumns.cardFlow !== "default") {
    throw new Error(`Safe two-column plan failed or changed card internals: ${JSON.stringify(twoColumns)}`);
  }

  // Large text, large controls, contrast, and automatic bottom viewport stay host-profile-owned.
  await openMenu(360, 667, "?mockAiLayout=menu-row&bottom-sdk=80&poc-profile=large-text-buttons-contrast-simple-guide10-scroll");
  const accessible = await readMenu();
  if (accessible.columns !== "1" || accessible.cardFlow !== "row" ||
      accessible.horizontalOverflow || accessible.textClipping) {
    throw new Error(`Mock layout conflicts with the accessibility profile: ${JSON.stringify(accessible)}`);
  }
  if (await evaluate("!document.querySelector('.kiosk')?.classList.contains('a11y-text-large')")) {
    throw new Error("Large-text profile was not retained under the mock layout.");
  }
  await waitFor(
    "document.querySelector('.a11y-guide-toast')?.classList.contains('a11y-guide-smart')",
    "Smart Guide with the mock layout",
    260,
  );
  await waitFor(`(() => {
    const hint = document.querySelector(".a11y-additional-menu-hint");
    return Boolean(hint && hint.getAttribute("aria-hidden") !== "true" &&
      getComputedStyle(hint).visibility !== "hidden");
  })()`, "scroll hint with the mock layout");
  const guidanceState = await evaluate(`(() => {
    const hint = document.querySelector(".a11y-additional-menu-hint");
    const guide = document.querySelector(".a11y-guide-toast");
    const hintRect = hint?.getBoundingClientRect();
    const guideRect = guide?.getBoundingClientRect();
    const controls = [...document.querySelectorAll("[data-a11y-qr-entry-dock], .cart-bar, .bottom-actions, .smart-guide-status")]
      .filter((element) => ["fixed", "sticky"].includes(getComputedStyle(element).position));
    const overlapsFixedControl = Boolean(hintRect && controls.some((element) => {
      const rect = element.getBoundingClientRect();
      return hintRect.left < rect.right && hintRect.right > rect.left &&
        hintRect.top < rect.bottom && hintRect.bottom > rect.top;
    }));
    return {
      smartGuide: Boolean(guide?.classList.contains("a11y-guide-smart")),
      hintVisible: Boolean(hint && hint.getAttribute("aria-hidden") !== "true"),
      hintPointerEvents: hint ? getComputedStyle(hint).pointerEvents : null,
      overlaysOverlap: Boolean(hintRect && guideRect && hintRect.left < guideRect.right &&
        hintRect.right > guideRect.left && hintRect.top < guideRect.bottom && hintRect.bottom > guideRect.top),
      overlapsFixedControl,
      viewportClass: document.querySelector(".kiosk")?.className ?? "",
    };
  })()`);
  if (!guidanceState.smartGuide || !guidanceState.hintVisible ||
      guidanceState.hintPointerEvents !== "none" ||
      guidanceState.overlaysOverlap || guidanceState.overlapsFixedControl) {
    throw new Error(`Mock layout conflicts with guidance or fixed controls: ${JSON.stringify(guidanceState)}`);
  }

  await click(".a11y-guide-close");
  await wait(700);
  const dismissed = await evaluate(`({
    smartGuideVisible: Boolean(document.querySelector(".a11y-guide-toast")?.classList.contains("a11y-guide-smart")),
    easyLanguagePanelVisible: Boolean(document.querySelector(".a11y-guide-toast")),
    scrollHintVisible: Boolean(document.querySelector(".a11y-additional-menu-hint")?.getAttribute("aria-hidden") !== "true")
  })`);
  if (dismissed.smartGuideVisible || !dismissed.easyLanguagePanelVisible || !dismissed.scrollHintVisible) {
    throw new Error(`Guide dismissal did not preserve the other guidance: ${JSON.stringify(dismissed)}`);
  }

  await evaluate(`(() => {
    const owner = document.querySelector(".a11y-bottom-viewport-scroll-area");
    if (owner) owner.scrollTop = owner.scrollHeight;
  })()`);
  await wait(250);
  const hiddenAtScrollEnd = await evaluate(`(() => {
    const hint = document.querySelector(".a11y-additional-menu-hint");
    return !hint || hint.getAttribute("aria-hidden") === "true" ||
      getComputedStyle(hint).visibility === "hidden";
  })()`);
  if (!hiddenAtScrollEnd) throw new Error("Scroll hint remained visible at the end of the transformed menu.");
  if (aiLayoutRequests.length !== 0) {
    throw new Error(`The browser unexpectedly called the AI relay: ${JSON.stringify(aiLayoutRequests)}`);
  }
  console.log(JSON.stringify({ label: "large-profile-guidance", width: 360, height: 667, accessible, guidanceState, dismissed, hiddenAtScrollEnd }));
  console.log(JSON.stringify({ result: "PASS" }));
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  await new Promise((resolve) => {
    if (browser.exitCode !== null || browser.signalCode !== null) return resolve();
    browser.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
  await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
