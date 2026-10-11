import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const { CENTRAL_QR_ORIGIN, createQrProfileClient, getManualProfileToken, getScannedProfileToken } = sdk;

const goodProfile = {
  textSize: "extraLarge", buttonSize: "large", contrast: "high", easyLanguage: true,
  bottomControls: true, smartGuide: true,
  voiceGuidance: true, guideDelaySeconds: 10,
};
const token = "valid-test-token-123456789";
const officialUrl = `${CENTRAL_QR_ORIGIN}/profile?token=${token}`;
const centralResponse = (schemaVersion, preferences = goodProfile) => ({
  schemaVersion,
  preferences,
  updatedAt: "2026-10-10T00:00:00.000Z",
});

test("scanner URL accepts only the official HTTPS origin and a single token", () => {
  assert.equal(getScannedProfileToken(officialUrl), token);
  assert.equal(getScannedProfileToken("http://naebangsikqr.replit.app/profile?token=x"), "");
  assert.equal(getScannedProfileToken("https://attacker.example/profile?token=x"), "");
  assert.equal(getScannedProfileToken(`${CENTRAL_QR_ORIGIN}/profile?token=a&token=b`), "");
  assert.equal(getScannedProfileToken(`${CENTRAL_QR_ORIGIN}/profile?token=a%0A`), "");
});

test("manual mode accepts a raw token or official URL, rejects arbitrary URLs", () => {
  assert.equal(getManualProfileToken(token), token);
  assert.equal(getManualProfileToken(officialUrl), token);
  assert.equal(getManualProfileToken("https://attacker.example/?token=x"), "");
});

test("profile client posts only the extracted token to the same-origin endpoint", async () => {
  let captured;
  const client = createQrProfileClient({
    fetcher: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify(centralResponse(2)), { status: 200 });
    },
  });
  const profile = await client.resolve(officialUrl, "scan");
  assert.equal(captured.url, "/api/qr-profile");
  assert.deepEqual(JSON.parse(captured.init.body), { token });
  assert.equal(profile.textSize, "extraLarge");
  assert.equal(profile.smartGuide, true);
});

test("v1 and v2 profiles apply only after strict required-field validation", async () => {
  const legacy = { ...goodProfile, simplifiedLayout: true };
  for (const schemaVersion of [1, 2]) {
    const client = createQrProfileClient({
      fetcher: async () => new Response(
        JSON.stringify(centralResponse(schemaVersion, schemaVersion === 1 ? legacy : goodProfile)),
        { status: 200 },
      ),
    });
    const profile = await client.resolve(token);
    assert.equal(profile.textSize, "extraLarge");
    assert.equal(profile.viewportMode, null);
    assert.equal("simplifiedLayout" in profile, false);
  }
});

test("v3 accepts only an explicit viewportMode and normalizes all preferences", async () => {
  const v3Preferences = {
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: false,
    viewportMode: { mode: "bottom", heightPercent: 70 },
    smartGuide: true,
    guideDelaySeconds: 10,
    voiceGuidance: false,
  };
  const client = createQrProfileClient({
    fetcher: async () => new Response(JSON.stringify(centralResponse(3, v3Preferences)), { status: 200 }),
  });
  const profile = await client.resolve(token);
  assert.deepEqual(profile.viewportMode, { mode: "bottom", heightPercent: 70 });
  assert.equal(profile.bottomControls, false);
  assert.equal(profile.textSize, "extraLarge");
  assert.equal(profile.smartGuide, true);

  for (const heightPercent of [60, 70, 80]) {
    const valid = createQrProfileClient({
      fetcher: async () => new Response(JSON.stringify(centralResponse(3, {
        ...v3Preferences,
        viewportMode: { mode: "bottom", heightPercent },
      })), { status: 200 }),
    });
    assert.deepEqual((await valid.resolve(token)).viewportMode, { mode: "bottom", heightPercent });
  }
  const nullMode = createQrProfileClient({
    fetcher: async () => new Response(JSON.stringify(centralResponse(3, {
      ...v3Preferences,
      viewportMode: null,
    })), { status: 200 }),
  });
  assert.equal((await nullMode.resolve(token)).viewportMode, null);
});

test("v3 rejects invalid, missing, string-valued and legacy viewport settings", async () => {
  const base = {
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: false,
    viewportMode: null,
    smartGuide: true,
    guideDelaySeconds: 10,
    voiceGuidance: false,
  };
  const invalidPreferences = [
    { ...base, viewportMode: { mode: "side", heightPercent: 70 } },
    { ...base, viewportMode: { mode: "bottom", heightPercent: "70" } },
    { ...base, viewportMode: { mode: "bottom", heightPercent: 50 } },
    { ...base, viewportMode: { mode: "bottom", heightPercent: 65 } },
    { ...base, viewportMode: { mode: "bottom", heightPercent: 90 } },
    { ...base, viewportMode: undefined },
    { ...base, bottomControls: true },
    { ...base, simplifiedLayout: true },
    { ...base, textSize: undefined },
    { ...base, voiceGuidance: "false" },
  ];
  for (const preferences of invalidPreferences) {
    const client = createQrProfileClient({
      fetcher: async () => new Response(JSON.stringify(centralResponse(3, preferences)), { status: 200 }),
    });
    await assert.rejects(client.resolve(token), /QR_UNAVAILABLE/);
  }
});

test("invalid QR data, unknown schema and unsupported response envelopes fail closed", async () => {
  let requests = 0;
  const unsupportedCases = [
    { schemaVersion: 4, preferences: goodProfile },
    { schemaVersion: 2, preferences: { ...goodProfile, simplifiedLayout: true } },
    { schemaVersion: 2, preferences: { ...goodProfile, textSize: "huge" } },
    { schemaVersion: 2, profile: { preferences: goodProfile } },
    { schemaVersion: 2, preferences: goodProfile },
  ];
  for (const body of unsupportedCases) {
    const client = createQrProfileClient({
      fetcher: async () => {
        requests += 1;
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    await assert.rejects(client.resolve(token), /QR_UNAVAILABLE/);
  }
  assert.equal(requests, 5);
});

test("central API 400 and 404 are unavailable QR errors; 500 is a lookup failure", async () => {
  for (const status of [400, 404]) {
    const client = createQrProfileClient({
      fetcher: async () => new Response(JSON.stringify({ error: "unavailable" }), { status }),
    });
    await assert.rejects(client.resolve(token), /QR_UNAVAILABLE/);
  }
  const failed = createQrProfileClient({
    fetcher: async () => new Response(JSON.stringify({ error: "server failure" }), { status: 500 }),
  });
  await assert.rejects(failed.resolve(token), /PROFILE_LOOKUP_FAILED/);
});

test("too-short and too-long tokens fail before issuing a request", async () => {
  let requests = 0;
  const client = createQrProfileClient({
    fetcher: async () => { requests += 1; return new Response("{}", { status: 200 }); },
  });
  await assert.rejects(client.resolve("short"), /QR_UNAVAILABLE/);
  assert.equal(getManualProfileToken("x".repeat(129)), "");
  assert.equal(requests, 0);
});

test("inactive QR profiles fail closed without applying defaults", async () => {
  let requests = 0;
  const client = createQrProfileClient({
    fetcher: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
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
  const pending = client.resolve(token);
  assert.equal(client.loading, true);
  client.cancel();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(aborted, true);
  assert.equal(client.loading, false);
  assert.equal(calls, 1);
});
