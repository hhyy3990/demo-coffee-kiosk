---
name: Universal layout contract runtime
description: Runtime and trust-boundary guidance for the supplied Universal Layout v1 package in DemoCoffee.
---

Use the supplied Universal Layout v1 source without reimplementing its canonical JSON or SHA-256 behavior. It imports `node:crypto`, and Node's strip-only TypeScript loader cannot parse its parameter-property syntax; execute its Development integration through `tsx` rather than changing the verbatim contract. Dynamically load the route only in Development so production startup does not import the Mock path.

The central host and auth values may reuse the existing `AI_LAYOUT_CENTRAL_URL`, `AI_LAYOUT_REPLIT_EXTERNAL_TOKEN`, and `AI_LAYOUT_SERVICE_TOKEN` settings, but Universal forwarding must have its own `UNIVERSAL_LAYOUT_RELAY_ENABLED` gate. Do not couple it to the menu.v2 relay flag or one-shot switch.

**Why:** The central package's exact hashes and validator are part of the contract, and the Node-only source must not leak into the React bundle or production route surface.

**How to apply:** Generate and validate models/plans on the Development server. Keep forwarding disabled unless explicitly enabled in Development. In the browser, compare screen identity, current accessibility/viewport snapshot, ordered item snapshot, connected target/count, and plan-to-model metadata before React commit; do not add a browser-side hash or duplicate validator. A copied policy fixture does not prove central API registration.
