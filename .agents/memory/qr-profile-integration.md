---
name: Central QR profile access
description: Public resolver CORS behavior and profile-schema migration compatibility.
---

The public central QR profile resolver rejects browser cross-origin preflight requests. Resolve profiles through a same-origin kiosk-server endpoint instead of calling the central service directly from the browser.

**Why:** A direct browser-style OPTIONS request to the public resolver returned HTTP 403, while server-side POST requests can reach the API.

**How to apply:** Keep the central service URL and resolver call in the server-side proxy for both development and production. Do not weaken or modify the separate central QR service's CORS policy for this kiosk.

## Profile schema rollout

The resolver's transitional contract accepts top-level `schemaVersion` 1 or 2 with a `preferences` object and valid `updatedAt`. Validate every required preference before applying. Ignore legacy `simplifiedLayout` only on v1; reject it on v2 and never expose it in the SDK profile type.

**Why:** The central service can continue serving v1 profiles while consumers move to v2, so rejecting v1 would break existing QR codes; carrying the removed field forward would make v2 ambiguous.

**How to apply:** Keep v1 compatibility until the issuer/service rollout is confirmed, fail closed on unknown versions or malformed responses, and do not treat invalid data as defaults.

## Camera scanner verification

Automated QR tests can feed generated QR frames through a local canvas-backed media stream to verify decoding, token handling, profile application, and track cleanup. This does not verify physical camera permissions, focus, or device behavior.

**Why:** Headless browser media streams and real cameras differ in permissions, secure-context handling, focus, and image quality.

**How to apply:** Report simulated scanner/API tests separately from real-device HTTPS camera checks. Do not claim hardware camera validation unless it was performed on an HTTPS device.
