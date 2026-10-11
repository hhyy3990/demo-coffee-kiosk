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

For a lower-viewport experiment, prefer temporarily styling the existing kiosk root as a fixed, bottom-anchored scroll shell; do not scale or reparent a React tree. Register viewport-fixed overlays explicitly through the adapter and restore all temporary classes and inline styles on cleanup. Validate guidance placement separately: a fixed scroll hint may overlap visible host content even when its position is within the reduced viewport.

**Why:** The same shell worked with both document-scroll and nested-scroll fixture structures while preserving click hit-testing, but the existing SDK hint placement is based on the full viewport and can cover content in a narrow lower viewport.

**How to apply:** Keep this approach experimental until host scroll ownership, fixed/modal overlays, and guidance collision behavior are verified in each target kiosk and on real portrait hardware.
