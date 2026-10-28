---
name: Universal layout contract runtime
description: Runtime and trust-boundary guidance for the supplied Universal Layout v1 package in DemoCoffee.
---

Use the supplied Universal Layout v1 source without reimplementing its canonical JSON or SHA-256 behavior. It imports `node:crypto`, and Node's strip-only TypeScript loader cannot parse its parameter-property syntax; execute its Development integration through `tsx` rather than changing the verbatim contract. Dynamically load the route only in Development so production startup does not import it. Central Mock and OpenAI endpoints both accept `{ "model": <validated model> }` and return the Universal v1 plan object itself. The local browser relay response remains `{ "model": <validated model>, "plan": <validated plan> }`.

The central host and auth values may reuse the existing `AI_LAYOUT_CENTRAL_URL`, `AI_LAYOUT_REPLIT_EXTERNAL_TOKEN`, and `AI_LAYOUT_SERVICE_TOKEN` settings, but Universal forwarding must have its own `UNIVERSAL_LAYOUT_RELAY_ENABLED` gate. Do not couple it to the menu.v2 relay flag or one-shot switch.

Keep the OpenAI-backed Universal endpoint on a separate Development route with its own `UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED=true` gate. Mock and OpenAI relays must be mutually exclusive; both use the shared model builder and validator, and the browser selects only one mode before rechecking the current screen/profile.

**Why:** The central package's exact hashes and validator are part of the contract, and the Node-only source must not leak into the React bundle or production route surface. The central APIs return a top-level plan, while the local React integration uses its own model-plan envelope.

**How to apply:** Generate and validate models/plans on the Development server; wrap the validated model under `model` when forwarding. Keep forwarding disabled unless explicitly enabled in Development. In the browser, compare screen identity, current accessibility/viewport snapshot, ordered item snapshot, connected target/count, and plan-to-model metadata before React commit; do not add a browser-side hash or duplicate validator. A copied policy fixture does not prove central API registration.

For the OpenAI route, require its own Development opt-in and keep it mutually exclusive with Mock relay mode.

**Why:** A Mock test must never silently become a paid AI request.

**How to apply:** Keep the OpenAI relay gate unset or false by default; fake-test the route and React path without contacting the central service.

Capture Development relay logs before disabling the gate or restarting the Workflow; the restarted process output may not retain the previous instance's request events.

**Why:** Without the original relay events, multiple browser-to-local requests cannot be reliably counted as central upstream calls after the restart.

**How to apply:** Read and save the relevant sanitized relay event counts before restoration, then restart and verify all gates are OFF.

OpenAI relay coalescing keys the complete validated model, not only selected hashes. In Development, its upstream attempt cap defaults to one per server process; a validated positive `UNIVERSAL_LAYOUT_OPENAI_MAX_UPSTREAM_REQUESTS` can raise the cap for controlled fake tests. The sanitized `central_upstream_started` event increments once per actual fetch attempt and its counter resets on server restart.

**Why:** Two browser-local requests do not establish the number of central calls; distinct models must remain separate, while duplicate OpenAI attempts need a hard cost limit.

**How to apply:** Keep the OpenAI gate OFF outside an authorized test, capture `central_upstream_started` events before restarting, and set a higher cap only for isolated Development tests.
