import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const consumerRoot = process.env.KIOSK_SDK_CONSUMER_ROOT;
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const sdkDir = consumerRoot
  ? resolve(consumerRoot, "node_modules/@naebangsik/kiosk-accessibility-sdk/dist")
  : resolve(packageRoot, "src");
export const sdk = consumerRoot
  ? await import(pathToFileURL(resolve(sdkDir, "index.js")).href)
  : await import(pathToFileURL(resolve(sdkDir, "index.ts")).href);
export const qrScanner = consumerRoot
  ? await import(pathToFileURL(resolve(sdkDir, "qr-scanner.js")).href)
  : await import(pathToFileURL(resolve(sdkDir, "qr-scanner.ts")).href);
