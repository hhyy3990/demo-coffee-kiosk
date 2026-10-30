---
name: Universal layout contract runtime
description: Runtime and trust-boundary guidance for the supplied Universal Layout v1 package in DemoCoffee.
---

Use the supplied Universal Layout v1 source without reimplementing its canonical JSON or SHA-256 behavior. It imports `node:crypto`, and Node's strip-only TypeScript loader cannot parse its parameter-property syntax; execute its Development integration through `tsx` rather than changing the verbatim contract. Dynamically load the route only in Development so production startup does not import it. Central Mock and OpenAI endpoints both accept `{ "model": <validated model> }` and return the Universal v1 plan object itself. The local browser relay response remains `{ "model": <validated model>, "plan": <validated plan> }`.

The central host and auth values may reuse the existing `AI_LAYOUT_CENTRAL_URL`, `AI_LAYOUT_REPLIT_EXTERNAL_TOKEN`, and `AI_LAYOUT_SERVICE_TOKEN` settings, but Universal forwarding must have its own `UNIVERSAL_LAYOUT_RELAY_ENABLED` gate. Do not couple it to the menu.v2 relay flag or one-shot switch.

Keep the OpenAI-backed Universal endpoint on a separate Development route with its own `UNIVERSAL_LAYOUT_OPENAI_RELAY_ENABLED=true` gate. Mock and OpenAI relays must be mutually exclusive; both use the shared model builder and validator, and the browser selects only one mode before rechecking the current screen/profile.

QR-triggered v2 automation has its own client-side Development gates: `VITE_DEMO_COFFEE_AI_LAYOUT_AUTO=true` plus exactly one of `VITE_DEMO_COFFEE_AI_LAYOUT_MOCK=true` or `VITE_DEMO_COFFEE_AI_LAYOUT_OPENAI=true`. The server-side v2 OpenAI gate remains independent; all gates default off.

**Why:** A browser opt-in must not authorize the server relay by itself, and a local Fake test must never become an OpenAI request when modes conflict.

**How to apply:** Keep both client and server gates off in the normal workflow. For a Fake test of the OpenAI UI path, enable the client mode only in an isolated Development build, keep the server upstream gate off, and intercept the browser request before it reaches the server.

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

The user reports that Central Development registered DemoCoffee `menu.v2` with `compact-grid` for A and `single-column-list` for G on `menu.product-list/arrangement`. G is limited to large text, large buttons, high contrast, and bottom-70; local hash checks matched the supplied compact/regular constraints and structure hash. This is not production registration evidence.

**Why:** Central Development registration was explicitly reported by the user, but this work made no central API call and verified only the local contract implementation.

**How to apply:** Keep the host option policy local and Development-only, verify supplied hashes with local fixtures, and do not infer Production registration or issue central requests without separate authorization.

Keep the v2 central Fake relay separate from both the local v2 Fake and v1/OpenAI relays. It must be Development-only, require its own explicit opt-in, validate the returned top-level plan against the current v2 model, and never fall back to the local Fake after a central error. Bound it to one upstream attempt per process unless a later authorized test requires otherwise.

**Why:** The central Fake is a distinct trust boundary; keeping independent controls prevents a local fixture or an unrelated AI switch from silently authorizing an upstream request.

**How to apply:** Leave `UNIVERSAL_LAYOUT_V2_RELAY_ENABLED` unset/false by default. Test with injected fetches and keep all real central/OpenAI calls explicitly authorized.

A single menu entry can produce duplicate browser-to-local v2 relay POSTs in Development; identical requests may be served by the in-flight coalescer or short success cache, so count `central_upstream_started` separately from browser requests.

**Why:** A live Development screen test observed two local relay POSTs but only one central upstream fetch; the second local request was a cache hit.

**How to apply:** Report both counts independently and keep the per-process upstream cap as the safety boundary.

Vite client flags are compile-time values. After changing Development workflow `VITE_*` gates, an already-open Preview tab can retain the previous bundle; one QR run reported the feature flag OFF even though the restarted workflow command enabled it.

**Why:** The old browser bundle skipped QR automation while the restarted server process had the temporary client gate set to true.

**How to apply:** Restart the Development workflow, fully reload Preview before applying QR, and verify the browser-side gate before actual QR entry. Server process configuration alone does not prove an existing tab loaded the new client flags.

For Central Development v2 OpenAI endpoint, the Central Agent confirmed the order is service Bearer authentication, JSON/schema validation, registry/model validation, pilot-scope validation, rate guard, then provider call. With a valid Bearer, an empty `{}` is rejected as `400 INVALID_REQUEST` before provider execution; an invalid Bearer returns `401 AUTH_REQUIRED`.

**Why:** DemoCoffee does not contain the central server implementation, so this ordering is based on Central Agent confirmation. A one-time empty-body probe returned `400 INVALID_REQUEST`, confirming that the configured service Bearer reached schema validation without invoking the provider.

**How to apply:** For this Development endpoint only, use an empty-body request to verify service authentication and schema reachability only after confirming the central validation order. Do not infer Production behavior or treat the result as evidence of a successful plan generation.
