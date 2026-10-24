# DemoCoffee Universal Layout Contract v1 Mapping

## Scope and evidence

This document records the current DemoCoffee host contracts and maps them to the supplied Universal Layout Contract v1 package. The included `demo-coffee-policy.ts` is a test/Mock fixture, not a statement that the central API has registered this policy.

The package defines `universal-layout.v1`, schema version 1, strict Zod request/plan models, `repeated-card-list`, and `setColumns`. It uses canonical JSON and SHA-256, with a golden vector asserted by the copied contract tests. This universal package is not wired to the central AI endpoint. The central temporary `options.v1` draft is still unavailable.

The Development Workflow command currently sets `AI_LAYOUT_RELAY_ENABLED=false`, `AI_LAYOUT_RELAY_ONE_SHOT=false`, `VITE_DEMO_COFFEE_AI_LAYOUT_AUTO=false`, and `VITE_DEMO_COFFEE_AI_LAYOUT_MOCK=false`. No central API or OpenAI call was made for this extraction.

## 1. Existing menu model and contract

Verified in `src/accessibility/menuLayoutPlan.ts`:

| Field | Current value or rule |
|---|---|
| `hostId` | `democoffee` |
| `screenId` | `cafe.menu` |
| `schemaVersion` | `2` |
| `structureVersion` | `menu.v2` |
| `structureHash` | FNV-1a 32-bit hash of the fixed semantic `STRUCTURE` string; standard 390px model: `837f86b3` |
| `constraintHash` | FNV-1a 32-bit hash of `JSON.stringify(constraints)`; standard 390px model: `df5bb9a5` |
| Viewport model | App canonicalizes actual width to 360px when `<=380`, otherwise 390px. `compact` is `<=380`; otherwise `regular`. |
| Minimum touch target | 44px |

The semantic model has three groups:

- `menu.product-list`: ordered repeated product cards; columns are mutable, item order and membership are preserved.
- `menu.product-card`: repeated item containing `menu.product-image` and `menu.product-information`; flow and gap are mutable, child order is preserved.
- `menu.product-information`: semantic name, price, description, and action children; no mutable properties.

Required IDs include category navigation, product list, fixed controls, and product action. Protected properties include the product-list items and order, category navigation, fixed controls, product content, and product-action behavior. The model does not contain product names, option choices, prices as values, or quantity; `price` occurs only as a semantic role/identifier.

### Accessibility constraints

`allowedColumns` is `[1]` for compact viewports. At widths up to 700px, non-standard text size or large buttons also force `[1]`; between 701–900px, extra-large text or large buttons force `[1]`. Otherwise it is `[1,2]`. `defaultColumns` follows the same single-column restriction and is otherwise 2. High contrast does not independently change the column rule, but is included in the constraint hash. Viewport mode is the explicit 60/70/80-percent mode, or 80 when easy language is enabled and no explicit mode is set.

### Current menu operations and validation

The allowed operations are:

1. `setGroupColumns` on `menu.product-list`, columns 1 or 2, constrained by `allowedColumns`.
2. `setGroupFlow` on `menu.product-card`, direction `row`, gap 8–20px.
3. `setChildBasis` on `menu.product-image`, basis 20–30 percent and minimum width 72–96px.

Plan objects and operation objects use exact-key validation. Plans must match schema version, screen ID, hashes, and viewport class; contain 1–3 operations; use each operation at most once and in the declared order. Flow and child-basis must occur together, and that card layout is accepted only when the effective product-list columns are 1. Unknown operations, targets, fields, or out-of-range values fail closed.

### React application and stale-plan behavior

`src/App.tsx` applies the validated result to the product grid and card elements identified by `data-menu-layout-id`. It records `data-ai-columns` and `data-ai-card-flow`, then measures the committed grid's computed `grid-template-columns` and card geometry in `react_dom_committed`. This separates plan validation from React/CSS success.

The menu gate captures generation, screen ID, structure hash, constraint hash, and viewport class. A plan is rejected if the gate or current model no longer matches. A viewport/profile change invalidates stale plans; leaving the menu stops the active application. The automatic menu coordinator caches validated plans by screen ID, hashes, and viewport class and deduplicates in-flight requests; invalidation clears that cache. Thus a later menu entry may reuse a valid plan for the same model, but not a plan for a changed model.

## 2. Existing product-options model and contract

Verified in `src/accessibility/optionLayoutPlan.ts` and its tests:

| Field | Current value or rule |
|---|---|
| `hostId` | `democoffee` |
| `screenId` | `cafe.product-options` |
| `schemaVersion` | `1` |
| `structureVersion` | `options.v1` |
| `structureHash` | FNV-1a 32-bit hash of the structural string plus ordered semantic group IDs |
| `constraintHash` | FNV-1a 32-bit hash of `JSON.stringify(constraints)` |
| Viewport model | Same canonicalization as menu: actual width `<=380` becomes 360px, otherwise 390px |

For the current default product with groups `temperature,size,cup` and standard accessibility settings:

| Canonical width | Viewport class | `structureHash` | `constraintHash` | Default / allowed columns |
|---|---|---|---|---|
| 360px | compact | `c720889d` | `444a0883` | 1 / `[1]` |
| 390px | regular | `c720889d` | `ef6c6600` | 2 / `[1,2]` |

`structureHash` is stable across those two widths because the ordered group inventory is the same. `constraintHash` changes with viewport and accessibility constraints. Group inventory is generated from the selected product: temperature is included only when that product has a temperature choice; size and cup are included for products supporting options; unsupported-option products have no groups.

Groups expose only semantic IDs (`temperature`, `size`, `cup`), role `single-choice-group`, and preservation flags for order and selection. The current model does not transmit selected values, option labels, product name/ID, prices, quantity, cart contents, or payment state.

### Accessibility constraints and operation

Options use the same column eligibility rules as the menu, with compact width or applicable large/extra-large text and large-button settings restricting columns to `[1]`. The contract records text scale, button scale, high contrast, viewport mode, default/allowed columns, and a 44px minimum target.

There is exactly one allowed operation:

- `setChoiceColumns` on `options.choice-groups`, columns 1 or 2, constrained by `allowedColumns`.

This operation applies a common column choice to the present option groups. It does not alter group contents, labels, order, selection, required rules, price, quantity, cart, actions, or navigation. Exact model/plan keys, version, screen ID, hashes, viewport class, target, operation count, and allowed columns are validated; unknown or extra data is rejected.

### React application and stale-plan behavior

`OptionChoiceLayout` wraps the existing choice buttons. `columns=null` preserves the prior `.choice-pills` layout; accepted 1- or 2-column values add a local modifier and `data-option-ai-columns`. The screen and group markers are `data-option-layout-screen="cafe.product-options"` and `data-option-ai-group`.

Development Mock application waits for an animation frame, rebuilds the current model, and checks both hashes before requesting a React state update. A model change (including viewport, accessibility profile, or selected product) cancels a committed plan; leaving the options stage cancels it as well. `react_dom_committed` measures the option group's computed `grid-template-columns` separately from plan validation.

The present Mock trigger is one-shot per page lifetime through a consumed ref. After a plan is canceled, it does not automatically issue another Mock plan on the same page. In contrast with the menu coordinator, the options path currently has no validated-plan cache or re-request coordinator.

## 3. Differences from the central temporary `options.v1` draft

The new ZIP provides the exact Universal v1 model and the `democoffee` / `cafe.menu` policy fixture. That policy confirms a repeated-card-list component `menu.product-list`, `setColumns`, compact `[1]`, regular/wide `[1,2]`, 44px touch target, and single-column forcing for large text and large buttons. It explicitly says this fixture is not active central API registration.

The central temporary options draft itself is not included. Its group IDs, field names, schema version, hashes, structure inventory, constraints, and operations therefore remain unverified.

Do not treat any central draft group ID or hash as a DemoCoffee value. Before connecting the host to a shared engine, compare the full central schema against:

- screen ID `cafe.product-options`;
- the actual ordered group IDs for the selected product;
- the host-generated structural and constraint hashes;
- the single `setChoiceColumns` operation and its target;
- the host accessibility constraints and exact-key validation.

## 4. Universal component mapping and legacy-operation mapping

| Host surface | Universal component candidate | Existing operation | Conceptual Universal mapping |
|---|---|---|---|
| Ordered product list | `repeated-card-list` | `setGroupColumns` on `menu.product-list` | `setColumns` on the list container |
| Option-choice groups | Possible future `choice-grid` | `setChoiceColumns` on `options.choice-groups` | Not supported by the supplied Universal v1 package/policy; no mapping should be implemented yet |

Universal v1 has no `setFlow` or `setChildBasis` operation: the current package only permits `setColumns`. Those existing menu.v2 operations therefore remain exclusive to the legacy path and are not part of this Universal Mock. The options screen is not supported by the supplied policy. Do not infer a Universal `choice-grid` policy from this package.

## 5. Accessibility policy and common validation requirements

A common validator must preserve the current fail-closed guarantees:

- bind every plan to host, screen, structure version/hash, constraints hash, and viewport class;
- allow only registered semantic targets and typed operations with bounded values;
- compute eligibility locally; never trust the plan to relax profile constraints;
- preserve required touch size and all explicitly protected or ordered content;
- reject additional keys, operations, targets, or data fields;
- revalidate against the current model immediately before React state commit;
- keep DOM/CSS verification separate from plan validation.

The app currently supplies enough semantic structure for layout planning without screen-specific product copy: menu groups and option group IDs describe roles and permitted layout changes. However, this does not establish that a generic central prompt or validator can safely interpret these models; that must be verified against the complete Universal contract and central implementation.

## 6. Minimal screen adapter information

A future screen adapter would need only:

- a stable AI screen ID and a mapping to the host/SDK screen identity;
- canonical viewport class and locally derived accessibility constraints;
- semantic groups, ordered child relationships, and preservation/protection declarations;
- structure and constraint fingerprints;
- the allowlisted operation schema and a host-owned application function;
- current-model revalidation and cancellation behavior.

It does not need item text, selected option values, prices, quantity, cart lines, payment data, or action callbacks.

## 7. SDK responsibility boundary

The local SDK package is `@naebangsik/kiosk-accessibility-sdk` v0.5.31. Its adapter derives SDK stage identity as `cafe.${stage}` (for options, `cafe.options`), while the AI layout contract intentionally uses `cafe.product-options`. Keep this distinction explicit rather than changing SDK identity to match the AI contract.

The SDK owns shared accessibility profile/presentation, guidance, observation, and diagnostics facilities. DemoCoffee owns its ordering workflow, React state, option selection, pricing, quantity, cart, navigation, and layout-plan application. The SDK does not own or execute AI layout operations, click controls, or mutate order data. This mapping requires no SDK changes.

## 8. ONE_SHOT scope and cross-screen interaction

`server.mjs` registers `registerAiLayoutRoute(app)` once. The route stores one `oneShotRequestConsumed` boolean in that registration, not one boolean per screen. It currently accepts only `validateMenuScreenModel()` (`menu.v2`). An options model sent to the existing route is rejected with local HTTP 400 before the ONE_SHOT check or any central request; therefore the options screen does not currently consume the menu relay's one-shot.

For accepted menu models, the relay checks its result cache and in-flight request map before the one-shot boolean. A valid cache hit or an identical in-flight request can be served without consuming another outbound request; the boolean is set when a new outbound central request is about to start. Otherwise, a later distinct model is blocked when ONE_SHOT is enabled.

If options support is added to this shared route without changing request accounting, the first uncached outbound request from either screen can consume the same process-wide one-shot. A future multi-screen engine should explicitly define one-shot scope (per session, per screen, or per host), cache keys, in-flight deduplication, and whether cached answers count as attempts. This document records the issue; it does not change the relay.

## 9. Data and ordering protections

For the menu, preserve product membership/order, category navigation, fixed controls, product content, and action behavior. For options, preserve labels/values/order, selected state, required-choice behavior, product and option prices, quantity, add-to-cart behavior, cart contents, navigation, and payment flow. Only the registered CSS layout properties are eligible for plan-controlled changes.

Diagnostics should remain limited to safe phases, IDs, model constraints, operation outcomes, and measured DOM/CSS results. Never add raw QR tokens, profile payloads, user selections, order data, or payment data to models, relay logs, or diagnostic history.

## 10. Items not verified

- Central API registration of the supplied DemoCoffee policy.
- The central temporary `options.v1` draft's exact IDs, hashes, operations, and constraints.
- Whether the central engine supports `choice-grid` or multiple option targets.
- Any central endpoint behavior; the supplied README explicitly says this package is not connected to it.
- Any central-side ONE_SHOT behavior; only the DemoCoffee Development relay implementation was inspected.

No AI plan, Health, or central API request was made for the contract extraction. See the implementation report for Development-only Mock changes and verification.
