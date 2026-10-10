import { spawnSync } from "node:child_process";

const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const url = "http://127.0.0.1:5000/packages/kiosk-accessibility-sdk/test/additional-menu-browser-fixture.html";
const result = spawnSync(chromium, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--window-size=390,844",
  "--virtual-time-budget=10000",
  "--dump-dom",
  url,
], { encoding: "utf8", timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || "");
  throw new Error(`Chromium browser fixture exited with ${result.status}`);
}

const match = result.stdout.match(/<pre id="fixture-result">([\s\S]*?)<\/pre>/);
if (!match) throw new Error("Chromium fixture did not emit a result.");
const report = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) throw new Error("One or more Chromium DOM/scroll checks failed.");
