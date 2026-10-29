import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromiumPath = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const appUrl = process.env.DEMOCOFFEE_URL || "http://127.0.0.1:5000";
const debugPort = 49800 + (process.pid % 150);
const userData = await mkdtemp(join(tmpdir(), "democoffee-universal-v2-"));
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
  let centralRequests = 0;
  let v2MockRequests = 0;
  let fakeQrProfileResponse = null;
  let fakeAutoAiMode = "local-mock";
  let fakeQrRequests = 0;
  let fakeAutoAiRequests = 0;
  let fakeV2LocalRequests = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Fetch.requestPaused") {
      void (async () => {
        const paused = message.params;
        const path = new URL(paused.request.url).pathname;
        if (path === "/api/qr-profile" && fakeQrProfileResponse !== null) {
          fakeQrRequests += 1;
          await send("Fetch.fulfillRequest", {
            requestId: paused.requestId,
            responseCode: fakeQrProfileResponse === false ? 502 : 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(
              fakeQrProfileResponse === false ? { error: "fake_qr_failure" } : fakeQrProfileResponse,
            )).toString("base64"),
          });
          return;
        }
        if (path === "/api/dev/universal-layout/v2/openai-plan" && fakeAutoAiMode) {
          fakeAutoAiRequests += 1;
          if (fakeAutoAiMode === "delayed-mock") await new Promise((resolve) => setTimeout(resolve, 350));
          if (fakeAutoAiMode === "local-mock" || fakeAutoAiMode === "delayed-mock") {
            fakeV2LocalRequests += 1;
            const response = await fetch(`${appUrl}/api/dev/universal-layout/v2/mock-plan`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: paused.request.postData,
            });
            await send("Fetch.fulfillRequest", {
              requestId: paused.requestId,
              responseCode: response.status,
              responseHeaders: [{ name: "Content-Type", value: "application/json" }],
              body: Buffer.from(await response.text()).toString("base64"),
            });
          } else {
            await send("Fetch.fulfillRequest", {
              requestId: paused.requestId,
              responseCode: 503,
              responseHeaders: [{ name: "Content-Type", value: "application/json" }],
              body: Buffer.from(JSON.stringify({ error: "RELAY_DISABLED" })).toString("base64"),
            });
          }
          return;
        }
        await send("Fetch.continueRequest", { requestId: paused.requestId });
      })().catch((error) => console.error("Fetch interception failed", error));
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = new URL(message.params.request.url);
      const path = requestUrl.pathname;
      if (requestUrl.origin !== new URL(appUrl).origin &&
          (path === "/api/ai-layout/plan" ||
          path === "/api/dev/universal-layout/plan" ||
          path === "/api/dev/universal-layout/openai-plan" ||
          path === "/api/dev/universal-layout/v2/openai-plan")) centralRequests += 1;
      if (path === "/api/dev/universal-layout/v2/mock-plan") v2MockRequests += 1;
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
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
  const visit = async (query, width = 1280, height = 900, mobile = false) => {
    try { await evaluate("sessionStorage.clear()"); } catch {}
    await send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile,
      screenWidth: width, screenHeight: height,
    });
    await send("Page.navigate", { url: `${appUrl}/${query}` });
    await until("Boolean(document.querySelector('#start-store'))", "welcome screen");
  };
  const submitManualQrToken = async () => {
    await until("Boolean(document.querySelector('[data-a11y-qr-entry-dock] button'))", "QR entry dock");
    await evaluate("document.querySelector('[data-a11y-qr-entry-dock] button').click()");
    await until("Boolean(document.querySelector('.qr-manual-toggle'))", "QR modal");
    await evaluate("document.querySelector('.qr-manual-toggle').click()");
    await until("Boolean(document.querySelector('#profile-token'))", "manual QR token form");
    await evaluate(`(() => {
      const input = document.querySelector('#profile-token');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '0123456789abcdefghij');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.qr-manual-form button[type="submit"]').click();
    })()`);
  };
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [
    { urlPattern: "*/api/qr-profile*", requestStage: "Request" },
    { urlPattern: "*/api/dev/universal-layout/v2/openai-plan*", requestStage: "Request" },
  ] });

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1");
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
    "compact-grid React state",
  );
  const applied = await evaluate(`(() => {
    const grid = document.querySelector('.product-grid');
    const card = grid?.querySelector('.product-card');
    const button = card?.querySelector('button');
    return {
      option: grid?.dataset.universalV2Option ?? null,
      gap: getComputedStyle(grid).gap,
      imageHeight: getComputedStyle(card?.querySelector('.product-art')).height,
      buttonMinHeight: getComputedStyle(button).minHeight,
      productIds: Array.from(grid.querySelectorAll('.product-card')).map(el => el.dataset.menuProductId),
      names: Array.from(grid.querySelectorAll('[data-menu-layout-id="menu.product-name"] h3')).map(el => el.textContent),
    };
  })()`);
  assert.equal(applied.option, "compact-grid");
  assert.equal(applied.gap, "10px");
  assert.equal(applied.imageHeight, "118px");
  assert.equal(applied.buttonMinHeight, "44px");
  assert.deepEqual(applied.productIds, [
    "americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea",
  ]);
  assert.equal(applied.names.length, 5);
  await evaluate("document.querySelector('#menu-product-0').click()");
  await until("Boolean(document.querySelector('#item-add'))", "product options");
  await evaluate("document.querySelector('#item-add').click()");
  await until("Boolean(document.querySelector('#menu-order-confirm'))", "menu after adding");
  const cartBarPosition = await evaluate(
    `getComputedStyle(document.querySelector('.cart-bar')).position`,
  );
  assert.equal(cartBarPosition, "sticky", "cart action bar is sticky, not fixed");
  await evaluate("document.querySelector('#menu-order-confirm').click()");
  await until("Boolean(document.querySelector('#cart-pay'))", "cart screen");
  const cartVerified = await evaluate(
    `document.body.innerText.includes('아메리카노') && document.body.innerText.includes('4,200원')`,
  );
  assert.equal(cartVerified, true, "selected product and price reached the cart");

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1", 390);
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
    "compact-grid at narrow regular viewport",
  );
  const narrowRegular = await evaluate(`(() => {
    const grid = document.querySelector('.product-grid');
    const cards = Array.from(grid.querySelectorAll('.product-card'));
    const boxes = cards.map(card => card.getBoundingClientRect());
    return {
      gap: getComputedStyle(grid).gap,
      imageHeight: getComputedStyle(grid.querySelector('.product-art')).height,
      buttonMinHeight: getComputedStyle(grid.querySelector('.product-card button')).minHeight,
      documentWidth: document.documentElement.scrollWidth,
      hasOverlaps: boxes.some((box, index) => boxes.slice(index + 1).some(other =>
        box.left < other.right && box.right > other.left &&
        box.top < other.bottom && box.bottom > other.top)),
    };
  })()`);
  assert.equal(narrowRegular.gap, "10px");
  assert.equal(narrowRegular.imageHeight, "104px");
  assert.equal(narrowRegular.buttonMinHeight, "44px");
  assert.ok(narrowRegular.documentWidth <= 390);
  assert.equal(narrowRegular.hasOverlaps, false);

  const desktopEvidence = [];
  for (const [width, expectedClass] of [[1080, "regular"], [1200, "wide"]]) {
    await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1", width);
    await evaluate("document.querySelector('#start-store').click()");
    await until(
      `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
      `compact-grid at ${expectedClass} viewport`,
    );
    const viewportEvidence = await evaluate(`(() => {
      const grid = document.querySelector('.product-grid');
      const cards = Array.from(grid.querySelectorAll('.product-card'));
      const boxes = cards.map(card => card.getBoundingClientRect());
      const hasOverlaps = boxes.some((box, index) => boxes.slice(index + 1).some(other =>
        box.left < other.right && box.right > other.left &&
        box.top < other.bottom && box.bottom > other.top));
      return {
        viewportWidth: window.innerWidth,
        viewportClass: (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
          .findLast(event => event.phase === 'plan_validated' && event.source === 'universal_v2_mock')
          ?.viewportClass ?? null,
        documentWidth: document.documentElement.scrollWidth,
        cardCount: cards.length,
        hasOverlaps,
        buttonMinimumHeight: Math.min(...cards.map(card =>
          Number.parseFloat(getComputedStyle(card.querySelector('button')).minHeight))),
      };
    })()`);
    assert.equal(viewportEvidence.viewportWidth, width);
    assert.equal(viewportEvidence.viewportClass, expectedClass);
    assert.ok(viewportEvidence.documentWidth <= width, `${width}px layout has no horizontal overflow`);
    assert.equal(viewportEvidence.cardCount, 5);
    assert.equal(viewportEvidence.hasOverlaps, false);
    assert.ok(viewportEvidence.buttonMinimumHeight >= 44);
    desktopEvidence.push(viewportEvidence);
  }

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1", 360);
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
    "compact-grid at compact viewport",
  );
  const compactViewport = await evaluate(`(() => {
    const grid = document.querySelector('.product-grid');
    const cards = Array.from(grid.querySelectorAll('.product-card'));
    const boxes = cards.map(card => card.getBoundingClientRect());
    return {
      columns: getComputedStyle(grid).gridTemplateColumns,
      gap: getComputedStyle(grid).gap,
      imageHeight: getComputedStyle(grid.querySelector('.product-art')).height,
      buttonMinHeight: getComputedStyle(grid.querySelector('.product-card button')).minHeight,
      documentWidth: document.documentElement.scrollWidth,
      hasOverlaps: boxes.some((box, index) => boxes.slice(index + 1).some(other =>
        box.left < other.right && box.right > other.left &&
        box.top < other.bottom && box.bottom > other.top)),
    };
  })()`);
  assert.equal(compactViewport.columns.split(/\\s+/).filter(Boolean).length, 1);
  assert.equal(compactViewport.gap, "10px");
  assert.equal(Number.parseFloat(compactViewport.buttonMinHeight) >= 44, true);
  assert.ok(compactViewport.documentWidth <= 360);
  assert.equal(compactViewport.hasOverlaps, false);

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1&mockCentralQrProfileForAiTest=large");
  await evaluate("document.querySelector('#start-store').click()");
  await until("Boolean(document.querySelector('.product-grid .product-card'))", "large-text menu");
  await wait(350);
  const largeText = await evaluate(`(() => ({
    option: document.querySelector('.product-grid')?.dataset.universalV2Option ?? null,
    gap: getComputedStyle(document.querySelector('.product-grid')).gap,
    columns: getComputedStyle(document.querySelector('.product-grid')).gridTemplateColumns,
  }))()`);
  assert.equal(largeText.option, null, "large-text profile removes the preset");
  assert.equal(largeText.gap, "14px", "baseline spacing is restored");

  const accessibilityProfiles = [
    { profile: "large-text", selector: ".a11y-text-large", textSize: "large", buttonSize: "standard" },
    { profile: "buttons", selector: ".a11y-controls-large", textSize: "standard", buttonSize: "large" },
    { profile: "large-text-buttons", selector: ".a11y-text-large.a11y-controls-large", textSize: "large", buttonSize: "large" },
  ];
  const accessibilityEvidence = [];
  for (const item of accessibilityProfiles) {
    await visit(
      `?menuLayoutDiagnostics=1&universalLayoutV2Mock=1&poc-profile=${item.profile}&bottom-poc=60`,
      390,
    );
    await until(
      `document.querySelector('.kiosk')?.matches('${item.selector}')`,
      `${item.profile} accessibility profile`,
    );
    await evaluate("document.querySelector('#start-store').click()");
    await until("Boolean(document.querySelector('.product-grid .product-card'))", `${item.profile} menu`);
    await wait(350);
    const profileEvidence = await evaluate(`(() => {
      const grid = document.querySelector('.product-grid');
      const event = (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .findLast(item => item.phase === 'request_started' && item.source === 'universal_v2_mock');
      const rejected = (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .findLast(item => item.phase === 'plan_rejected' && item.source === 'universal_v2_mock');
      return {
        option: grid?.dataset.universalV2Option ?? null,
        requestViewportClass: event?.viewportClass ?? null,
        rejectionReason: rejected?.reason ?? null,
        columns: getComputedStyle(grid).gridTemplateColumns,
        cardCount: grid?.querySelectorAll('.product-card').length ?? 0,
        documentWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert.equal(profileEvidence.option, null, `${item.profile} must reject compact-grid`);
    assert.equal(profileEvidence.requestViewportClass, "regular");
    assert.equal(profileEvidence.rejectionReason, "UNSUPPORTED_PLAN_OPERATION");
    assert.equal(profileEvidence.cardCount, 5);
    assert.ok(profileEvidence.documentWidth <= 390);
    assert.ok(profileEvidence.columns.length > 0);
    accessibilityEvidence.push({ profile: item.profile, ...profileEvidence });
  }

  const runMutatedPlan = async (mutation, expectedLabel, profileQuery = "", width = 1280) => {
    await visit(`?menuLayoutDiagnostics=1&universalLayoutV2Mock=1${profileQuery}`, width);
    if (profileQuery.includes("mockCentralQrProfileForAiTest")) {
      await until(
        "document.querySelector('.kiosk')?.classList.contains('a11y-text-large')",
        "test G profile before plan mutation",
      );
    }
    await evaluate(`(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname !== '/api/dev/universal-layout/v2/mock-plan') return nativeFetch(input, init);
        const response = await nativeFetch(input, init);
        const payload = await response.json();
        ${mutation}
        return new Response(JSON.stringify(payload), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    })()`);
    await evaluate("document.querySelector('#start-store').click()");
    try {
      await until(
        `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_rejected' && e.source === 'universal_v2_mock' && e.reason === 'response_model_plan_mismatch')`,
        expectedLabel,
      );
    } catch {
      const diagnostics = await evaluate(
        `JSON.stringify((window.__demoCoffeeMenuLayoutDiagnostics ?? []).slice(-8))`,
      );
      throw new Error(`${expectedLabel}; recent diagnostics: ${diagnostics}`);
    }
    assert.equal(
      await evaluate("document.querySelector('.product-grid')?.dataset.universalV2Option ?? null"),
      null,
    );
  };
  await runMutatedPlan(
    "payload.plan.operations[0].optionId = 'unregistered-grid';",
    "unregistered option rejection",
  );
  await runMutatedPlan(
    "payload.plan.constraintHash = '0'.repeat(64);",
    "hash mismatch rejection",
  );
  await runMutatedPlan(
    "payload.plan.operations[0].optionId = 'compact-grid';",
    "G disallowed option rejection",
    "&mockCentralQrProfileForAiTest=g",
    390,
  );
  await runMutatedPlan(
    "payload.plan.constraintHash = '0'.repeat(64);",
    "G stale hash rejection",
    "&mockCentralQrProfileForAiTest=g",
    390,
  );

  const gLayoutEvidence = [];
  for (const width of [360, 390]) {
    await visit(
      "?menuLayoutDiagnostics=1&universalLayoutV2Mock=1&mockCentralQrProfileForAiTest=g",
      width,
      844,
      true,
    );
    await evaluate(`(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__gV2Request = null;
      window.fetch = (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/dev/universal-layout/v2/mock-plan') {
          window.__gV2Request = JSON.parse(init.body);
        }
        return nativeFetch(input, init);
      };
    })()`);
    await evaluate("document.querySelector('#start-store').click()");
    await until(
      `document.querySelector('.product-grid')?.dataset.universalV2Option === 'single-column-list'`,
      `G single-column-list at ${width}px`,
    );
    const view = await evaluate(`(() => {
      const grid = document.querySelector('.product-grid');
      const cards = Array.from(grid.querySelectorAll('.product-card'));
      const cart = document.querySelector('.cart-bar');
      const cartRect = cart?.getBoundingClientRect() ?? null;
      const cardRects = cards.map(card => card.getBoundingClientRect());
      const accessibility = (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .findLast(event => event.phase === 'request_started' && event.source === 'universal_v2_mock');
      const lastButton = cards.at(-1)?.querySelector('button');
      const buttonRect = lastButton.getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        option: grid.dataset.universalV2Option,
        columns: getComputedStyle(grid).gridTemplateColumns.split(/\\\\s+/).filter(Boolean).length,
        ids: cards.map(card => card.dataset.menuProductId),
        cartPosition: cart ? getComputedStyle(cart).position : null,
        cartBottom: cartRect?.bottom ?? null,
        maxCardBottom: Math.max(...cardRects.map(rect => rect.bottom)),
        cardCartOverlap: cartRect ? cardRects.some(rect =>
          rect.left < cartRect.right && rect.right > cartRect.left &&
          rect.top < cartRect.bottom && rect.bottom > cartRect.top) : false,
        buttonHeight: buttonRect.height,
        request: window.__gV2Request,
        kioskClasses: document.querySelector('.kiosk').className,
      };
    })()`);
    assert.equal(view.width, width);
    assert.equal(view.height, 844);
    assert.equal(view.option, "single-column-list");
    assert.equal(view.columns, 1);
    assert.deepEqual(view.ids, [
      "americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea",
    ]);
    assert.equal(view.cardCartOverlap, false);
    assert.ok(view.buttonHeight >= 44);
    assert.ok(view.kioskClasses.includes("a11y-text-large"));
    assert.ok(view.kioskClasses.includes("a11y-controls-large"));
    assert.ok(view.kioskClasses.includes("a11y-high-contrast"));
    assert.ok(view.kioskClasses.includes("a11y-bottom-controls"));
    assert.deepEqual(view.request.accessibility, {
      textScale: "large",
      buttonScale: "large",
      contrast: "high",
      viewportMode: { mode: "bottom", heightPercent: 70 },
    });
    assert.equal(view.request.viewportClass, width === 360 ? "compact" : "regular");

    await evaluate("document.querySelector('#menu-product-4').scrollIntoView({block:'center',behavior:'instant'})");
    const hit = await evaluate(`(() => {
      const button = document.querySelector('#menu-product-4');
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target === button || button.contains(target);
    })()`);
    assert.equal(hit, true, `last product button hit-test at ${width}px`);
    await evaluate("document.querySelector('#menu-product-4').click()");
    await until("Boolean(document.querySelector('#item-add'))", "G product options");
    await evaluate("document.querySelector('#item-add').click()");
    await until("Boolean(document.querySelector('#menu-order-confirm'))", "G menu after add");
    const cartOverlap = await evaluate(`(() => {
      const cart = document.querySelector('.cart-bar');
      const cartRect = cart.getBoundingClientRect();
      return {
        position: getComputedStyle(cart).position,
        overlap: Array.from(document.querySelectorAll('.product-card')).some(card => {
          const rect = card.getBoundingClientRect();
          return rect.left < cartRect.right && rect.right > cartRect.left &&
            rect.top < cartRect.bottom && rect.bottom > cartRect.top;
        }),
      };
    })()`);
    assert.equal(cartOverlap.position, "static");
    assert.equal(cartOverlap.overlap, false);
    await evaluate("document.querySelector('#menu-order-confirm').click()");
    await until("Boolean(document.querySelector('#cart-pay'))", "G cart");
    const cartText = await evaluate("document.body.innerText");
    assert.match(cartText, /레몬티/);
    assert.match(cartText, /4,600원/);
    gLayoutEvidence.push(view);
  }

  const fakeV5GProfile = {
    schemaVersion: 5,
    updatedAt: "2026-10-30T00:00:00.000Z",
    preferences: {
      textSize: "large",
      buttonSize: "large",
      contrast: "high",
      easyLanguage: true,
      viewportMode: { mode: "bottom", heightPercent: 70 },
      smartGuide: true,
      voiceGuidance: false,
      guideDelaySeconds: 15,
      language: "ko",
      stepByStepGuidance: false,
      conciseGuidance: false,
      slowGuidance: false,
      scrollGuidance: true,
    },
  };
  const qrAutoEvidence = [];
  for (const width of [360, 390]) {
    fakeQrProfileResponse = fakeV5GProfile;
    fakeAutoAiMode = "local-mock";
    fakeQrRequests = 0;
    fakeAutoAiRequests = 0;
    fakeV2LocalRequests = 0;
    await visit("?menuLayoutDiagnostics=1", width, 844, true);
    await send("Network.setBlockedURLs", { urls: ["https://*"] });
    await evaluate(`(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__qrLookupCount = 0;
      window.__autoAiCount = 0;
      window.__v2FallbackCount = 0;
      window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/dev/universal-layout/v2/openai-plan') {
          window.__autoAiCount += 1;
          return nativeFetch(input, init);
        }
        if (url.pathname === '/api/dev/universal-layout/v2/mock-plan') {
          window.__v2FallbackCount += 1;
        }
        return nativeFetch(input, init);
      };
    })()`);
    await until("Boolean(document.querySelector('[data-a11y-qr-entry-dock] button'))", "QR entry dock");
    await evaluate("document.querySelector('[data-a11y-qr-entry-dock] button').click()");
    await until("Boolean(document.querySelector('.qr-manual-toggle'))", "QR modal");
    await evaluate("document.querySelector('.qr-manual-toggle').click()");
    await until("Boolean(document.querySelector('#profile-token'))", "manual QR token form");
    await evaluate(`(() => {
      const input = document.querySelector('#profile-token');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '0123456789abcdefghij');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.qr-manual-form button[type="submit"]').click();
    })()`);
    await until(
      `!document.querySelector('.qr-modal') && document.querySelector('.kiosk')?.classList.contains('a11y-bottom-viewport-enabled')`,
      "successful fake v5 QR profile applied by the SDK",
    );
    assert.equal(fakeQrRequests, 1);
    assert.equal(await evaluate("window.__autoAiCount"), 0, "QR success waits until the menu screen");
    assert.equal(await evaluate("document.querySelector('.kiosk').classList.contains('a11y-bottom-controls')"), false);
    await evaluate("document.querySelector('#start-store').click()");
    await until(
      `document.querySelector('.product-grid')?.dataset.universalV2Option === 'single-column-list'`,
      `QR-triggered G AI plan at ${width}px`,
    );
    await wait(250);
    const auto = await evaluate(`(() => ({
      requests: window.__autoAiCount,
      source: (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .findLast(event => event.phase === 'plan_validated' && event.source === 'universal_v2_qr_auto')?.source ?? null,
      option: document.querySelector('.product-grid')?.dataset.universalV2Option ?? null,
      width: innerWidth,
      viewportMode: getComputedStyle(document.querySelector('.kiosk'))
        .getPropertyValue('--a11y-bottom-viewport-height').trim(),
    }))()`);
    assert.equal(auto.requests, 1, "one automatic OpenAI-relay request per QR application");
    assert.equal(fakeQrRequests, 1);
    assert.equal(fakeV2LocalRequests, 1, "the OpenAI-relay test adapter uses only the local Fake response");
    auto.qrLookups = fakeQrRequests;
    assert.equal(auto.source, "universal_v2_qr_auto");
    assert.equal(auto.option, "single-column-list");
    assert.equal(auto.width, width);
    assert.match(auto.viewportMode, /844px|590px/);
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll('.product-card')).map(card => card.dataset.menuProductId)`),
      ["americano", "latte", "vanilla-latte", "cold-brew", "lemon-tea"],
    );
    await evaluate("document.querySelector('#menu-product-4').scrollIntoView({block:'center',behavior:'instant'})");
    assert.equal(await evaluate(`(() => {
      const button = document.querySelector('#menu-product-4');
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === button || button.contains(hit);
    })()`), true);
    await evaluate("document.querySelector('#menu-product-4').click()");
    await until("Boolean(document.querySelector('#item-add'))", "QR-auto product options");
    await evaluate("document.querySelector('#item-add').click()");
    await until("Boolean(document.querySelector('#menu-order-confirm'))", "QR-auto cart bar");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cart-bar')).position"), "static");
    await evaluate("document.querySelector('#menu-order-confirm').click()");
    await until("Boolean(document.querySelector('#cart-pay'))", "QR-auto cart screen");
    assert.match(await evaluate("document.body.innerText"), /레몬티/);
    assert.equal(await evaluate("window.__autoAiCount"), 1, "rerenders do not repeat a QR request");
    qrAutoEvidence.push(auto);
    await send("Network.setBlockedURLs", { urls: [] });
  }

  const standardV5Profile = {
    ...fakeV5GProfile,
    preferences: {
      ...fakeV5GProfile.preferences,
      textSize: "standard",
      buttonSize: "standard",
      contrast: "standard",
      easyLanguage: false,
      viewportMode: null,
      smartGuide: false,
      scrollGuidance: false,
    },
  };
  fakeQrProfileResponse = standardV5Profile;
  fakeAutoAiMode = "local-mock";
  fakeQrRequests = 0;
  fakeAutoAiRequests = 0;
  await visit("?menuLayoutDiagnostics=1", 390, 844, true);
  await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__qrLookupCount = 0;
    window.__autoAiCount = 0;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/dev/universal-layout/v2/openai-plan') {
        window.__autoAiCount += 1;
        return nativeFetch(input, init);
      }
      return nativeFetch(input, init);
    };
  })()`);
  await evaluate("document.querySelector('[data-a11y-qr-entry-dock] button').click()");
  await evaluate("document.querySelector('.qr-manual-toggle').click()");
  await evaluate(`(() => {
    const input = document.querySelector('#profile-token');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '0123456789abcdefghij');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.qr-manual-form button[type="submit"]').click();
  })()`);
  await until("!document.querySelector('.qr-modal')", "standard QR profile applied");
  await evaluate("document.querySelector('#start-store').click()");
  await wait(300);
  assert.equal(fakeQrRequests, 1);
  assert.equal(await evaluate("window.__autoAiCount"), 0, "non-G QR profiles do not request AI");
  assert.equal(await evaluate("document.querySelector('.product-grid')?.dataset.universalV2Option ?? null"), null);

  fakeQrProfileResponse = fakeV5GProfile;
  fakeAutoAiMode = "fail";
  fakeQrRequests = 0;
  fakeAutoAiRequests = 0;
  fakeV2LocalRequests = 0;
  await visit("?menuLayoutDiagnostics=1", 390, 844, true);
  await submitManualQrToken();
  await until(
    `!document.querySelector('.qr-modal') && document.querySelector('.kiosk')?.classList.contains('a11y-bottom-viewport-enabled')`,
    "G QR accessibility settings applied before AI failure",
  );
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(event =>
      event.phase === 'plan_rejected' && event.source === 'universal_v2_qr_auto' &&
      event.reason === 'RELAY_DISABLED')`,
    "automatic relay failure",
  );
  assert.equal(fakeQrRequests, 1);
  assert.equal(fakeAutoAiRequests, 1);
  assert.equal(fakeV2LocalRequests, 0, "relay failure does not fall back to Mock");
  assert.equal(await evaluate("document.querySelector('.kiosk').classList.contains('a11y-text-large')"), true);
  assert.equal(await evaluate("document.querySelector('.kiosk').classList.contains('a11y-bottom-viewport-enabled')"), true);
  assert.equal(await evaluate("document.querySelector('.product-grid')?.dataset.universalV2Option ?? null"), null);

  fakeQrProfileResponse = false;
  fakeAutoAiMode = "local-mock";
  fakeQrRequests = 0;
  fakeAutoAiRequests = 0;
  await visit("?menuLayoutDiagnostics=1", 390, 844, true);
  await submitManualQrToken();
  await until("Boolean(document.querySelector('.qr-error'))", "fake QR lookup failure");
  assert.equal(fakeQrRequests, 1);
  await evaluate("document.querySelector('.qr-modal .icon-button').click()");
  await evaluate("document.querySelector('#start-store').click()");
  await wait(300);
  assert.equal(fakeAutoAiRequests, 0, "failed QR lookups do not trigger automatic AI");
  fakeQrProfileResponse = null;
  fakeAutoAiMode = null;

  await visit("?menuLayoutDiagnostics=1&mockCentralQrProfileForAiTest=g", 390, 844, true);
  await evaluate("document.querySelector('#start-store').click()");
  await wait(300);
  assert.equal(
    await evaluate(`(window.__demoCoffeeMenuLayoutDiagnostics ?? [])
      .some(event => event.source === 'universal_v2_qr_auto' && event.phase === 'request_started')`),
    false,
    "test-only profile fixtures do not trigger automatic AI",
  );

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Mock=1");
  await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/api/dev/universal-layout/v2/mock-plan') return nativeFetch(input, init);
      window.__v2FakePending = true;
      await new Promise(resolve => setTimeout(resolve, 350));
      return nativeFetch(input, { ...init, signal: undefined });
    };
  })()`);
  await evaluate("document.querySelector('#start-store').click()");
  await until("window.__v2FakePending === true", "delayed fake plan");
  await evaluate("document.querySelector('#menu-product-0').click()");
  await until("Boolean(document.querySelector('#item-add'))", "screen transition");
  await wait(500);
  assert.equal(await evaluate("document.querySelector('.product-grid') === null"), true);
  const staleRejected = await evaluate(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_rejected' && e.source === 'universal_v2_mock' && e.reason === 'stale_screen_or_model')`,
  );
  assert.equal(staleRejected, true, "late response is rejected after screen change");

  const stickyMatrix = [];
  const stickyProfiles = [
    { id: "standard", query: "standard", selector: "" },
    { id: "large-text", query: "large-text", selector: ".a11y-text-large" },
    { id: "large-buttons", query: "buttons", selector: ".a11y-controls-large" },
    { id: "large-text-and-buttons", query: "large-text-buttons", selector: ".a11y-text-large.a11y-controls-large" },
  ];
  for (const width of [360, 390, 1080, 1200]) {
    for (const profile of stickyProfiles) {
      await visit(
        `?menuLayoutDiagnostics=1&universalLayoutV2Mock=1&poc-profile=${profile.query}&bottom-poc=60`,
        width,
      );
      if (profile.selector) {
        await until(
          `document.querySelector('.kiosk')?.matches('${profile.selector}')`,
          `${profile.id} profile at ${width}px`,
        );
      } else {
        await wait(100);
      }
      await evaluate(`(() => {
        const url = new URL(location.href);
        url.searchParams.delete('bottom-poc');
        history.replaceState(null, '', url);
      })()`);
      await evaluate("document.querySelector('#start-store').click()");
      await until("Boolean(document.querySelector('#menu-product-4'))", `menu at ${width}px`);
      await wait(300);

      const presetBeforeCart = await evaluate(
        `document.querySelector('.product-grid')?.dataset.universalV2Option ?? null`,
      );
      assert.equal(
        presetBeforeCart,
        profile.id === "standard" ? "compact-grid" : null,
        `${profile.id} plan behavior at ${width}px`,
      );

      await evaluate(`(() => {
        const last = document.querySelector('#menu-product-4');
        last.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()`);
      await wait(100);
      const lastProductBeforeCart = await evaluate(`(() => {
        const button = document.querySelector('#menu-product-4');
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          visible: rect.bottom > 0 && rect.top < innerHeight,
          centerHit: hit === button || button.contains(hit),
          hitTarget: hit?.id ?? hit?.closest('button')?.id ?? null,
          buttonHeight: rect.height,
          centerX: x,
          centerY: y,
        };
      })()`);
      assert.equal(lastProductBeforeCart.visible, true);
      assert.equal(lastProductBeforeCart.centerHit, true);
      assert.ok(lastProductBeforeCart.buttonHeight >= 44);
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: lastProductBeforeCart.centerX,
        y: lastProductBeforeCart.centerY,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: lastProductBeforeCart.centerX,
        y: lastProductBeforeCart.centerY,
        button: "left",
        clickCount: 1,
      });
      await until("Boolean(document.querySelector('#item-add'))", `last product options at ${width}px`);
      await evaluate("document.querySelector('#item-add').click()");
      await until("Boolean(document.querySelector('.cart-bar'))", `sticky cart bar at ${width}px`);

      const stickyAtTop = await evaluate(`(() => {
        window.scrollTo(0, 0);
        const bar = document.querySelector('.cart-bar');
        const rect = bar.getBoundingClientRect();
        return {
          position: getComputedStyle(bar).position,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          scrollY: window.scrollY,
        };
      })()`);
      assert.equal(stickyAtTop.position, "sticky");
      assert.ok(stickyAtTop.width > 0 && stickyAtTop.height > 0);
      assert.ok(stickyAtTop.documentWidth <= width);

      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.round(width / 2),
        y: 450,
        deltaX: 0,
        deltaY: 5000,
      });
      await wait(250);
      const stickyAtPageBottom = await evaluate(`(() => {
        const bar = document.querySelector('.cart-bar');
        const card = document.querySelector('[data-menu-product-id="lemon-tea"]');
        const barRect = bar.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const intersects = cardRect.left < barRect.right && cardRect.right > barRect.left &&
          cardRect.top < barRect.bottom && cardRect.bottom > barRect.top;
        return {
          scrollY: window.scrollY,
          scrollTop: document.scrollingElement.scrollTop,
          documentHeight: document.scrollingElement.scrollHeight,
          scrollClientHeight: document.scrollingElement.clientHeight,
          barTop: barRect.top,
          barBottom: barRect.bottom,
          barHeight: barRect.height,
          lastCardTop: cardRect.top,
          lastCardBottom: cardRect.bottom,
          viewportHeight: innerHeight,
          overlapAtNaturalBottom: intersects,
          documentWidth: document.documentElement.scrollWidth,
        };
      })()`);
      assert.ok(stickyAtPageBottom.scrollY + stickyAtPageBottom.viewportHeight >=
        stickyAtPageBottom.documentHeight - 1,
        `${profile.id} reached page bottom at ${width}px: ${JSON.stringify(stickyAtPageBottom)}`);
      assert.equal(stickyAtPageBottom.overlapAtNaturalBottom, false,
        `${profile.id} natural-bottom overlap at ${width}px`);
      assert.ok(stickyAtPageBottom.documentWidth <= width);

      await evaluate(`document.querySelector('#menu-product-4').scrollIntoView({
        block: 'center', behavior: 'instant'
      })`);
      await wait(100);
      const lastProductWithCartBar = await evaluate(`(() => {
        const button = document.querySelector('#menu-product-4');
        const card = button.closest('.product-card');
        const bar = document.querySelector('.cart-bar');
        const cardRect = card.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const intersects = cardRect.left < barRect.right && cardRect.right > barRect.left &&
          cardRect.top < barRect.bottom && cardRect.bottom > barRect.top;
        const buttonRect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          buttonRect.left + buttonRect.width / 2,
          buttonRect.top + buttonRect.height / 2,
        );
        return {
          cardBarOverlap: intersects,
          buttonVisible: buttonRect.bottom > 0 && buttonRect.top < innerHeight,
          buttonCenterHit: hit === button || button.contains(hit),
          buttonHeight: buttonRect.height,
          buttonCenterX: buttonRect.left + buttonRect.width / 2,
          buttonCenterY: buttonRect.top + buttonRect.height / 2,
          cardTop: cardRect.top,
          cardBottom: cardRect.bottom,
          barTop: barRect.top,
          barBottom: barRect.bottom,
          viewportHeight: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
        };
      })()`);
      assert.equal(lastProductWithCartBar.cardBarOverlap, false,
        `${profile.id} last-card overlap at ${width}px`);
      assert.equal(lastProductWithCartBar.buttonVisible, true);
      assert.equal(lastProductWithCartBar.buttonCenterHit, true);
      assert.ok(lastProductWithCartBar.buttonHeight >= 44);
      assert.ok(lastProductWithCartBar.documentWidth <= width);

      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: lastProductWithCartBar.buttonCenterX,
        y: lastProductWithCartBar.buttonCenterY,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: lastProductWithCartBar.buttonCenterX,
        y: lastProductWithCartBar.buttonCenterY,
        button: "left",
        clickCount: 1,
      });
      await until("Boolean(document.querySelector('.item-add')) || Boolean(document.querySelector('#item-add'))",
        `last product remains clickable with cart bar at ${width}px`);
      await evaluate("document.querySelector('.back-button').click()");
      await until("Boolean(document.querySelector('.cart-bar'))", `return to menu at ${width}px`);
      stickyMatrix.push({
        viewportWidth: width,
        profile: profile.id,
        presetBeforeCart,
        beforeCartButtonHeight: lastProductBeforeCart.buttonHeight,
        barHeightAtTop: stickyAtTop.height,
        barPosition: stickyAtTop.position,
        pageBottomScrollY: stickyAtPageBottom.scrollY,
        documentHeight: stickyAtPageBottom.documentHeight,
        pageBottomOverlap: stickyAtPageBottom.overlapAtNaturalBottom,
        lastCardOverlap: lastProductWithCartBar.cardBarOverlap,
        lastButtonHit: lastProductWithCartBar.buttonCenterHit,
        lastButtonHeight: lastProductWithCartBar.buttonHeight,
      });
    }
  }

  await visit("?menuLayoutDiagnostics=1&universalLayoutV2Relay=1");
  await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__v2RelayUiRequests = 0;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/api/dev/universal-layout/v2/relay-plan') return nativeFetch(input, init);
      window.__v2RelayUiRequests += 1;
      return nativeFetch('/api/dev/universal-layout/v2/mock-plan', init);
    };
  })()`);
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
    "central relay UI branch using local Fake response",
  );
  assert.equal(await evaluate("window.__v2RelayUiRequests"), 1);
  const relayUiSource = await evaluate(
    `(window.__demoCoffeeMenuLayoutDiagnostics ?? []).some(e => e.phase === 'plan_validated' && e.source === 'universal_v2_central')`,
  );
  assert.equal(relayUiSource, true, "central relay mode reaches the React preset path");
  assert.equal(centralRequests, 0, "no relay or OpenAI endpoints were called");
  assert.ok(v2MockRequests >= 5, "only the local v2 Fake endpoint was used");
  await visit("?menuLayoutDiagnostics=1&universalLayoutV2OpenAi=1", 390);
  await evaluate(`(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__v2OpenAiUiRequests = 0;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname !== '/api/dev/universal-layout/v2/openai-plan') return nativeFetch(input, init);
      window.__v2OpenAiUiRequests += 1;
      return nativeFetch('/api/dev/universal-layout/v2/mock-plan', init);
    };
  })()`);
  await evaluate("document.querySelector('#start-store').click()");
  await until(
    `document.querySelector('.product-grid')?.dataset.universalV2Option === 'compact-grid'`,
    "OpenAI relay UI branch using local Fake response",
  );
  assert.equal(await evaluate("window.__v2OpenAiUiRequests"), 1);
  const openAiUiEvidence = await evaluate(`(() => {
    const grid = document.querySelector('.product-grid');
    return {
      source: (window.__demoCoffeeMenuLayoutDiagnostics ?? [])
        .findLast(e => e.phase === 'plan_validated')?.source ?? null,
      width: innerWidth,
      gap: getComputedStyle(grid).gap,
      imageHeight: getComputedStyle(grid.querySelector('.product-art')).height,
      productIds: Array.from(grid.querySelectorAll('.product-card')).map(
        card => card.dataset.menuProductId,
      ),
    };
  })()`);
  assert.equal(openAiUiEvidence.source, "universal_v2_openai");
  assert.equal(openAiUiEvidence.width, 390);
  assert.equal(openAiUiEvidence.gap, "10px");
  assert.equal(openAiUiEvidence.imageHeight, "104px");
  assert.equal(openAiUiEvidence.productIds.length, 5);
  assert.equal(centralRequests, 0, "the OpenAI UI branch was served by the local Fake");
  console.log(JSON.stringify({
    applied, narrowRegular, compactViewport, gLayoutEvidence, qrAutoEvidence,
    desktopEvidence,
    accessibilityEvidence,
    cartBarPosition,
    cartVerified,
    largeText,
    invalidOptionRejected: true,
    hashMismatchRejected: true,
    staleRejected,
    stickyMatrix,
    relayUiSource,
    relayUiRequests: await evaluate("window.__v2RelayUiRequests"),
    openAiUiEvidence,
    openAiUiRequests: await evaluate("window.__v2OpenAiUiRequests"),
    centralRequests,
    v2MockRequests,
  }, null, 2));
} finally {
  socket?.close();
  try { process.kill(-browser.pid, "SIGTERM"); } catch {}
  await Promise.race([
    browserExit,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
