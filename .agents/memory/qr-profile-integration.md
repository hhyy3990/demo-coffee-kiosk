---
name: Central QR profile access
description: Public resolver CORS behavior and profile-schema migration compatibility.
---

The public central QR profile resolver rejects browser cross-origin preflight requests. Resolve profiles through a same-origin kiosk-server endpoint instead of calling the central service directly from the browser.

**Why:** A direct browser-style OPTIONS request to the public resolver returned HTTP 403, while server-side POST requests can reach the API.

**How to apply:** Keep the central service URL and resolver call in the server-side proxy for both development and production. Do not weaken or modify the separate central QR service's CORS policy for this kiosk.

## Profile schema rollout

The resolver accepts schema versions 1–5 and validates each version before applying. Versions 1–2 use the legacy `bottomControls` field; versions 3–5 use `viewportMode` and reject legacy fields. Version 4+ requires the language and guidance flags. Version 5 accepts optional `scrollGuidance`, normalizing absence to `false`.

**Why:** Older issued QR codes remain in circulation while newer profiles use the viewport and guidance schema. Dropping legacy support or silently defaulting malformed data can change a user's saved accessibility settings.

**How to apply:** Preserve version-specific validation, reject unknown or malformed schemas, and never convert invalid profile responses into defaults.

## Isolated QR-flow tests

The QR client captures its `fetch` implementation when it is created. Patching `window.fetch` after app mount does not reliably fake QR lookups; intercept the browser request and fulfill it with a local v5 profile instead.

**Why:** The client is constructed during initial render, before test instrumentation commonly replaces `window.fetch`; a missed interception can reach the real profile service.

**How to apply:** For automatic-layout tests, submit a token through the real QR UI, fulfill `/api/qr-profile` at the browser network layer, and block outbound requests. Do not use the direct profile fixture to test QR-triggered behavior.

## Camera scanner verification

Automated QR tests can feed generated QR frames through a local canvas-backed media stream to verify decoding, token handling, profile application, and track cleanup. This does not verify physical camera permissions, focus, or device behavior.

**Why:** Headless browser media streams and real cameras differ in permissions, secure-context handling, focus, and image quality.

**How to apply:** Report simulated scanner/API tests separately from real-device HTTPS camera checks. Do not claim hardware camera validation unless it was performed on an HTTPS device.
