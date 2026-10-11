---
name: Shared kiosk accessibility SDK boundary
description: Project rule for separating reusable accessibility behavior from each kiosk's order or service workflow.
---

The shared accessibility SDK owns profile validation and presentation, inactivity timing, generic Smart Guide rendering and button highlighting, browser voice, and read-only layout diagnostics. A kiosk adapter supplies semantic screen/action identifiers, live action elements, and only the minimal state needed to choose guidance.

The host kiosk remains the only owner of business actions and state. The SDK must never click controls or mutate ordering, payment, clinical, or other service workflows. Keep the existing central QR profile schema and API stable; layout diagnostics must not include QR tokens, visible text, or personal state.

For menu-overflow guidance, the host explicitly registers the current screen's real menu-item elements and may provide localized wording. The SDK measures the host's actual scroll owner and only presents a non-interactive hint when more registered items are reachable; it must not invent, filter, or reveal business data.

Observers that trigger profile or layout work must ignore SDK-owned hint/guide insertions, removals, and mutations. A floating hint can otherwise be mistaken for host content, causing repeated profile/layout application while scrolling and browser scroll anchoring to shift the user's position.

**Why:** The same accessibility profile should work across unrelated kiosks without making their critical workflows depend on a shared UI package or AI-generated code changes.

**How to apply:** When integrating another kiosk, implement its semantic adapter and host-specific guide rules, then use the SDK only for presentation, timing, voice, and observation. Filter SDK-owned nodes at observer boundaries; prefer verified CSS adjustments, and never let diagnostics or AI mutate business DOM or execute actions.

The SDK's lower-viewport method accepts 60%, 70%, and 80% heights. Central QR profile v3 carries an explicit `preferences.viewportMode` (`null` or `{ mode: "bottom", heightPercent: 60 | 70 | 80 }`) and the SDK applies it through the shared layout path. Normalize v1/v2 to `null`; never infer viewport mode from legacy `bottomControls`. Measure the SDK-owned QR dock and registered fixed controls when calculating the usable viewport.

**Why:** v3 makes the requested viewport mode explicit without reinterpreting legacy flags; each host still has different fixed controls and scroll ownership. Browser verification showed those obstacles must be measured to keep the final item reachable.

**How to apply:** Route validated v3 profile settings through the SDK's common viewport controller; keep v1/v2 behavior unchanged. Restore SDK-owned classes and inline styles on `endSession()`. Verify host scroll ownership, fixed/modal overlays, and guidance placement on each kiosk. Transform/contain ancestors and unusual nested scroll layouts still require host-specific testing.

Overlay-only DOM mutations should update the overlay registry without reconfiguring the underlying scroll owner or fixed-control geometry. Re-measure only when the registered scroll target or anchored control set changes.

**Why:** Reapplying the scroll shell during modal insertion/removal can introduce viewport geometry changes and scroll anchoring even though the host's scroll owner did not change.

**How to apply:** In mutation observers, compare the resolved scroll target and anchored-control identities before reconfiguring; continue updating modal avoidance and hint visibility independently.

For SDK-owned kiosk UI that must coexist with a React host, mount the SDK element outside the React-managed subtree and let the host provide its root, active-screen state, and action callback. If it shares the viewport with fixed host controls, the host adapter must register those controls so the SDK can measure and reserve their real occupied area; do not relocate host nodes.

**Why:** React may reconcile away elements inserted inside its managed tree, and an unmeasured fixed control can overlap an otherwise correctly positioned SDK dock.

**How to apply:** Keep the integration boundary explicit and reversible. Measure registered fixed controls, reserve their current geometry, and test both long scrolling content and a host layout with its own fixed controls.

Fixed QR docks and controls can live outside the SDK's registered scroll root. Measure fixed overlays against the viewport rather than clipping them to that root, and resolve body/document scrolling to the browser's actual document scroller. A hint is only safe when its measured rectangle avoids those fixed regions.

**Why:** A scroll-root clip can make a visible fixed dock disappear from the obstacle set, leaving the hint positioned over it even when the algorithm reports success.

**How to apply:** Treat viewport-fixed obstacles separately from sticky descendants, then verify their real DOM rectangles and menu reachability in Chromium at narrow, short, and kiosk-sized viewports.
