import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const viewports = [[320, 844], [390, 844], [1080, 1920]];
const structures = ["document", "long-menu", "fixed-controls"];
const percentages = [60, 70, 80];
const scenarios = viewports.flatMap((viewport) => [
  { viewport, structure: "document", percent: 70 },
  ...structures.slice(1).flatMap((structure) =>
    percentages.map((percent) => ({ viewport, structure, percent })),
  ),
]);
const reports = [];

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
    await evaluate("document.querySelector('.a11y-qr-entry-dock-button').click()");
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
    await evaluate("document.querySelector('#start-store').click()");
    let menuReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      menuReady = await evaluate("Boolean(document.querySelector('.section-heading') && !document.querySelector('.a11y-qr-entry-dock'))");
      if (menuReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!menuReady) throw new Error(`Menu transition did not hide the home QR dock at ${viewWidth}x${viewHeight}.`);
    const orderViewportHeight = await evaluate("document.querySelector('.shell').getBoundingClientRect().height");
    if (Math.abs(orderViewportHeight - viewHeight * percent / 100) > 2) {
      throw new Error(`Order viewport did not use ${percent}% at ${viewWidth}x${viewHeight}: ${orderViewportHeight}px.`);
    }
    await evaluate("document.querySelector('#menu-product-0').click()");
    let optionReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      optionReady = await evaluate("Boolean(document.querySelector('#item-add'))");
      if (optionReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!optionReady) throw new Error(`Menu selection/options failed at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('.back-button').click()");
    let backReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      backReady = await evaluate("Boolean(document.querySelector('#menu-product-0'))");
      if (backReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!backReady) throw new Error(`Back from options did not restore menu at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('#menu-product-0').click()");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      optionReady = await evaluate("Boolean(document.querySelector('#item-add'))");
      if (optionReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!optionReady) throw new Error(`Reopening options after Back failed at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('#item-add').click()");
    let confirmReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      confirmReady = await evaluate("Boolean(document.querySelector('#menu-order-confirm'))");
      if (confirmReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!confirmReady) throw new Error(`Adding the menu item failed at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('#menu-order-confirm').click()");
    let cartReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      cartReady = await evaluate("Boolean(document.querySelector('#cart-pay'))");
      if (cartReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!cartReady) throw new Error(`Cart screen failed at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('#cart-pay').click()");
    let paymentReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      paymentReady = await evaluate("Boolean(document.querySelector('#payment-pay'))");
      if (paymentReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!paymentReady) throw new Error(`Payment screen failed at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('#payment-pay').click()");
    let completeReady = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      completeReady = await evaluate("Boolean(document.querySelector('#complete-reset'))");
      if (completeReady) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!completeReady) throw new Error(`Demo payment completion failed at ${viewWidth}x${viewHeight}.`);
    const receiptChoiceReady = await evaluate("Boolean(document.querySelector('.receipt-actions button'))");
    if (!receiptChoiceReady) throw new Error(`Receipt choice missing at ${viewWidth}x${viewHeight}.`);
    await evaluate("document.querySelector('.receipt-actions button').click()");
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
      await evaluate("document.querySelector('#complete-reset').click()");
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
if (reports.length !== 21 || reports.some((report) => !report.pass)) {
  throw new Error("QR entry PoC browser verification failed.");
}
