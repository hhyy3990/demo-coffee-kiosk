import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const { CENTRAL_QR_ORIGIN, createQrProfileClient, getManualProfileToken, getScannedProfileToken } = sdk;

const goodProfile = {
  textSize: "extraLarge", buttonSize: "large", contrast: "high", easyLanguage: true,
  simplifiedLayout: true, bottomControls: true, smartGuide: true,
  voiceGuidance: true, guideDelaySeconds: 10,
};
const officialUrl = `${CENTRAL_QR_ORIGIN}/profile?token=valid-test-token`;

test("scanner URL accepts only the official HTTPS origin and a single token", () => {
  assert.equal(getScannedProfileToken(officialUrl), "valid-test-token");
  assert.equal(getScannedProfileToken("http://naebangsikqr.replit.app/profile?token=x"), "");
  assert.equal(getScannedProfileToken("https://attacker.example/profile?token=x"), "");
  assert.equal(getScannedProfileToken(`${CENTRAL_QR_ORIGIN}/profile?token=a&token=b`), "");
  assert.equal(getScannedProfileToken(`${CENTRAL_QR_ORIGIN}/profile?token=a%0A`), "");
});

test("manual mode accepts a raw token or official URL, rejects arbitrary URLs", () => {
  assert.equal(getManualProfileToken("valid-test-token"), "valid-test-token");
  assert.equal(getManualProfileToken(officialUrl), "valid-test-token");
  assert.equal(getManualProfileToken("https://attacker.example/?token=x"), "");
});

test("profile client posts only the extracted token to the same-origin endpoint", async () => {
  let captured;
  const client = createQrProfileClient({
    fetcher: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ preferences: goodProfile }), { status: 200 });
    },
  });
  const profile = await client.resolve(officialUrl, "scan");
  assert.equal(captured.url, "/api/qr-profile");
  assert.deepEqual(JSON.parse(captured.init.body), { token: "valid-test-token" });
  assert.equal(profile.textSize, "extraLarge");
  assert.equal(profile.smartGuide, true);
});

test("invalid and inactive QR profiles fail closed without applying defaults", async () => {
  let requests = 0;
  const client = createQrProfileClient({
    fetcher: async () => {
      requests += 1;
      return new Response(JSON.stringify({ status: "disabled", preferences: goodProfile }), { status: 200 });
    },
  });
  await assert.rejects(client.resolve("https://attacker.example/?token=x", "scan"), /QR_UNAVAILABLE/);
  assert.equal(requests, 0);
  await assert.rejects(client.resolve(officialUrl, "scan"), /QR_UNAVAILABLE/);
});

test("lookup can be aborted and a later lookup can proceed", async () => {
  let aborted = false;
  let calls = 0;
  const client = createQrProfileClient({
    fetcher: (_url, init) => {
      calls += 1;
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    },
  });
  const pending = client.resolve("valid-test-token");
  assert.equal(client.loading, true);
  client.cancel();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(aborted, true);
  assert.equal(client.loading, false);
  assert.equal(calls, 1);
});
