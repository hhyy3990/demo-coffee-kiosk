import { spawn } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const url = "http://127.0.0.1:5000/packages/kiosk-accessibility-sdk/test/additional-menu-browser-fixture.html";

async function runFixture(width, height, index) {
  const port = 9440 + index;
  const child = spawn(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/kiosk-sdk-browser-${globalThis.process.pid}-${port}`,
    "--window-size=1200,2000",
    url,
  ], { stdio: "ignore", detached: true });
  let socket;
  try {
    let target;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`))
          .json()).find((item) => item.type === "page");
        if (target) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    if (!target) throw new Error(`Chromium did not start at ${width}x${height}.`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let commandId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const reply = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
      return reply.result?.value;
    };

    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    if (index === 3) {
      await send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    }
    let report;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const state = await evaluate(`({
        width: innerWidth,
        height: innerHeight,
        status: document.body?.dataset.testStatus,
        result: document.querySelector("#fixture-result")?.textContent
      })`);
      if (state.width === width && state.height === height && state.status) {
        report = JSON.parse(state.result);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!report) throw new Error(`Chromium fixture did not finish at ${width}x${height}.`);
    return { viewport: `${width}x${height}`, ...report };
  } finally {
    try { socket?.close(); } catch {}
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  }
}

const reports = [];
for (const [index, [width, height]] of [[320, 844], [360, 667], [390, 844], [1080, 1920]].entries()) {
  reports.push(await runFixture(width, height, index));
}
console.log(JSON.stringify(reports, null, 2));
if (reports.some((report) => !report.passed)) {
  throw new Error("One or more Chromium DOM/scroll checks failed.");
}
