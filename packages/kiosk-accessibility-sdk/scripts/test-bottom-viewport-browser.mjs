import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const url = "http://127.0.0.1:5000/packages/kiosk-accessibility-sdk/test/layout-browser-fixture.html";
const sizes = [[320, 844], [390, 844], [1080, 1920]];
const reports = [];

for (const [index, [width, height]] of sizes.entries()) {
  const port = 9670 + index;
  const child = spawn(chromium, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/kiosk-sdk-viewport-${process.pid}-${port}`,
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
    if (!page) throw new Error(`Chromium did not start for ${width}x${height}.`);
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
      width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height,
    });
    await send("Page.navigate", { url });
    let state;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      state = await evaluate(`({
        width: innerWidth,
        height: innerHeight,
        status: document.body?.dataset.testStatus,
        result: window.bottomViewportResult,
      })`);
      if (state.result && state.width === width && state.height === height) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!state?.result || state.width !== width || state.height !== height) {
      throw new Error(`The fixture did not finish at the requested CSS viewport ${width}x${height}.`);
    }
    const modalTests = await evaluate("window.runModalScrollTests()");
    reports.push({ viewport: `${width}x${height}`, status: state.status, ...state.result, modalTests });
  } finally {
    try { socket?.close(); } catch {}
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  }
}

console.log(JSON.stringify(reports, null, 2));
if (reports.some((report) => report.status !== "passed" || !report.pass || !report.modalTests?.pass)) {
  throw new Error("Bottom viewport browser checks failed.");
}
