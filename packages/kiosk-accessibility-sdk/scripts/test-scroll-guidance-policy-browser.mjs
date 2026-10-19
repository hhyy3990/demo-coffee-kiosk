import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const consumerRoot = process.env.KIOSK_SDK_CONSUMER_ROOT;
if (!consumerRoot) throw new Error("KIOSK_SDK_CONSUMER_ROOT is required.");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = 48600 + (process.pid % 700);
const debugPort = port + 700;
const baseUrl = `http://127.0.0.1:${port}`;
const userData = await mkdtemp(join(tmpdir(), "sdk-scroll-policy-chromium-"));
const vite = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/.bin/vite"),
  "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", "build",
], { cwd: consumerRoot, stdio: "ignore" });
const browser = spawn(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore", detached: true });

let socket;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) { ready = true; break; }
    } catch {}
    if (vite.exitCode !== null) throw new Error(`Vite preview exited with ${vite.exitCode}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Consumer preview did not start.");
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
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 390, screenHeight: 844,
  });
  await send("Page.navigate", {
    url: `${baseUrl}/qr-entry.html?structure=inner&percent=none`,
  });
  let loaded = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    loaded = await evaluate("Boolean(window.qrConsumerTest?.verifyEasyLanguageScrollGuidancePolicy)");
    if (loaded) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!loaded) throw new Error("Easy Language QR policy fixture did not load.");
  const result = await evaluate("window.qrConsumerTest.verifyEasyLanguageScrollGuidancePolicy()");
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) throw new Error("Scroll guidance profile policy failed in Chromium.");
} finally {
  try { socket?.close(); } catch {}
  try { process.kill(-browser.pid, "SIGTERM"); } catch { browser.kill("SIGTERM"); }
  vite.kill("SIGTERM");
  await Promise.all([browser, vite].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  })));
  await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
