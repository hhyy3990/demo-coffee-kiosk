---
name: Shared kiosk accessibility SDK boundary
description: Project rule for separating reusable accessibility behavior from each kiosk's order or service workflow.
---

The shared accessibility SDK owns profile validation and presentation, inactivity timing, generic Smart Guide rendering and button highlighting, browser voice, and read-only layout diagnostics. A kiosk adapter supplies semantic screen/action identifiers, live action elements, and only the minimal state needed to choose guidance.

The host kiosk remains the only owner of business actions and state. The SDK must never click controls or mutate ordering, payment, clinical, or other service workflows. Keep the existing central QR profile schema and API stable; layout diagnostics must not include QR tokens, visible text, or personal state.

For menu-overflow guidance, the host explicitly registers the current screen's real menu-item elements and may provide localized wording. The SDK measures the host's actual scroll owner and only presents a non-interactive hint when more registered items are reachable; it must not invent, filter, or reveal business data.

**Why:** The same accessibility profile should work across unrelated kiosks without making their critical workflows depend on a shared UI package or AI-generated code changes.

**How to apply:** When integrating another kiosk, implement its semantic adapter and host-specific guide rules, then use the SDK only for presentation, timing, voice, and observation. Prefer verified CSS adjustments; do not let diagnostics or AI mutate the DOM or execute actions.
