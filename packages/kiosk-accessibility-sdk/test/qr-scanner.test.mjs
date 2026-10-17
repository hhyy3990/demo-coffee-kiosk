import test from "node:test";
import assert from "node:assert/strict";
import { qrScanner } from "./load-sdk.mjs";
const { mountQrScanner } = qrScanner;

function fixture() {
  const videoListeners = new Map();
  const video = {
    srcObject: null, paused: false, readyState: 2, videoWidth: 640,
    pause() { this.paused = true; },
    addEventListener(type, callback) { videoListeners.set(type, callback); },
    removeEventListener(type) { videoListeners.delete(type); },
    dispatch(type) { videoListeners.get(type)?.(); },
  };
  const placeholder = { hidden: false };
  const status = { textContent: "" };
  const button = {
    disabled: false,
    textContent: "",
    addEventListener(_name, handler) { this.click = handler; },
  };
  const container = {
    innerHTML: "",
    emptied: false,
    querySelector(selector) {
      return selector === "video" ? video : selector.includes("placeholder") ? placeholder :
        selector.includes("status") ? status : button;
    },
    replaceChildren() { this.emptied = true; },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia() {} } } });
  return {
    video, status, button, placeholder, container,
    restore() {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete globalThis.window;
      if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
      else delete globalThis.navigator;
    },
  };
}

test("a decoded QR stops the camera immediately and duplicate callbacks are ignored", async () => {
  let stopped = 0;
  let scans = 0;
  const controls = { stop() { stopped += 1; } };
  const f = fixture();
  try {
    const handle = mountQrScanner({
      container: f.container,
      readerFactory: () => ({
        decodeFromVideoDevice(_device, _video, callback) {
          f.video.dispatch("loadeddata");
          callback({ getText: () => "official-qr" }, undefined, controls);
          callback({ getText: () => "duplicate-qr" }, undefined, controls);
          return Promise.resolve(controls);
        },
      }),
      onScan: (value) => { assert.equal(value, "official-qr"); scans += 1; },
      onCameraUnavailable() {},
    });
    await handle.start();
    assert.equal(scans, 1);
    assert.equal(stopped, 1);
    assert.equal(f.video.paused, true);
    assert.equal(f.placeholder.hidden, true);
    handle.destroy();
    assert.equal(f.container.emptied, true);
  } finally {
    f.restore();
  }
});

test("camera permission denial is surfaced in the scanner status and host callback", async () => {
  let unavailable = "";
  const f = fixture();
  try {
    const handle = mountQrScanner({
      container: f.container,
      readerFactory: () => ({
        decodeFromVideoDevice: async () => { throw new DOMException("denied", "NotAllowedError"); },
      }),
      onScan() {},
      onCameraUnavailable: (message) => { unavailable = message; },
    });
    await handle.start();
    assert.match(unavailable, /카메라 사용 권한이 없어요/);
    assert.equal(f.status.textContent, unavailable);
  } finally {
    f.restore();
  }
});
