---
name: Central QR profile access
description: Non-obvious browser CORS behavior for the public accessibility-profile resolver.
---

The public central QR profile resolver rejects browser cross-origin preflight requests. Resolve profiles through a same-origin kiosk-server endpoint instead of calling the central service directly from the browser.

**Why:** A direct browser-style OPTIONS request to the public resolver returned HTTP 403, while server-side POST requests can reach the API.

**How to apply:** Keep the central service URL and resolver call in the server-side proxy for both development and production. Do not weaken or modify the separate central QR service's CORS policy for this kiosk.

## Camera scanner verification

Automated QR tests can feed generated QR frames through a local canvas-backed media stream to verify decoding, token handling, profile application, and track cleanup. This does not verify physical camera permissions, focus, or device behavior.

**Why:** Headless browser media streams and real cameras differ in permissions, secure-context handling, focus, and image quality.

**How to apply:** Report simulated scanner/API tests separately from real-device HTTPS camera checks. Do not claim hardware camera validation unless it was performed on an HTTPS device.
