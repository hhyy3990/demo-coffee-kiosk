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

The SDK's lower-viewport method accepts 60%, 70%, and 80% heights. Central QR profiles v3/v4 carry explicit `preferences.viewportMode` (`null` or `{ mode: "bottom", heightPercent: 60 | 70 | 80 }`) and the SDK applies it through the shared layout path. Normalize v1/v2 to `null`; never infer viewport mode from legacy `bottomControls`. v4 adds language and guidance-style preferences; older schemas must normalize these to inactive defaults.

**Why:** Explicit viewport modes avoid reinterpreting legacy flags, while version-gating the new v4 preferences prevents stale QR profiles from unexpectedly enabling new behavior. Each host still has different fixed controls and scroll ownership.

**How to apply:** Route validated v3/v4 profile settings through the SDK's common viewport controller; preserve v1-v3 behavior and keep v4-only preferences inert for older schemas. Restore SDK-owned classes and inline styles on `endSession()`. Verify host scroll ownership, fixed/modal overlays, and guidance placement on each kiosk. Transform/contain ancestors and unusual nested scroll layouts still require host-specific testing.

Overlay-only DOM mutations should update the overlay registry without reconfiguring the underlying scroll owner or fixed-control geometry. Re-measure only when the registered scroll target or anchored control set changes.

**Why:** Reapplying the scroll shell during modal insertion/removal can introduce viewport geometry changes and scroll anchoring even though the host's scroll owner did not change.

**How to apply:** In mutation observers, compare the resolved scroll target and anchored-control identities before reconfiguring; continue updating modal avoidance and hint visibility independently.

For SDK-owned kiosk UI that must coexist with a React host, mount the SDK element outside the React-managed subtree and let the host provide its root, active-screen state, and action callback. If it shares the viewport with fixed host controls, the host adapter must register those controls so the SDK can measure and reserve their real occupied area; do not relocate host nodes.

**Why:** React may reconcile away elements inserted inside its managed tree, and an unmeasured fixed control can overlap an otherwise correctly positioned SDK dock.

**How to apply:** Keep the integration boundary explicit and reversible. Measure registered fixed controls, reserve their current geometry, and test both long scrolling content and a host layout with its own fixed controls.

Fixed QR docks and controls can live outside the SDK's registered scroll root. Measure fixed overlays against the viewport rather than clipping them to that root, and resolve body/document scrolling to the browser's actual document scroller. A hint is only safe when its measured rectangle avoids those fixed regions.

**Why:** A scroll-root clip can make a visible fixed dock disappear from the obstacle set, leaving the hint positioned over it even when the algorithm reports success.

**How to apply:** Treat viewport-fixed obstacles separately from sticky descendants, then verify their real DOM rectangles and menu reachability in Chromium at narrow, short, and kiosk-sized viewports.

Business-screen scroll resets are host-signaled through a stable, distinct screen ID. The SDK should resolve only the registered scroll region and document scroller, reset the previous/current owners after a bounded layout settle, and leave same-screen changes, dialogs, guidance, and resize alone.

**Why:** Frameworks and host workflows know when a real task screen changed; DOM heuristics cannot reliably distinguish that from ordinary content updates, and broad descendant resets disrupt unrelated scrolling.

**How to apply:** Notify once after a committed screen transition. Cancel a pending reset on user input, cancel remembered work on `endSession()`, and test both document and nested scroll ownership with SDK docks and fixed controls.

Smart Guide state uses a separate host-owned `stepId`, distinct from the scroll screen ID. A new task step cancels stale guidance and starts the profile delay; message-only updates within the same step preserve the timer and refresh visible copy. Timer callbacks must ignore canceled generations.

**Why:** A kiosk can change option values or open a confirmation dialog without changing its scroll owner, while frequent guide-copy updates must not indefinitely restart the idle timer or let a stale message appear on the next step.

**How to apply:** Give each meaningful host task step a stable, non-personal ID; update the message in place for value changes, and call `notifyScreenChange()` only when the actual screen/scroll owner changes.

The unified easy-language/Smart Guide panel renders only host-supplied explanations. Keep the host's explanation `stepId` aligned with the corresponding guide step when they describe the same task state; after a committed screen change, replace the old explanation with the new screen's copy.

**Why:** Shared presentation can be reused across unrelated kiosks, but only the host knows what its screens mean. Mismatched or stale step IDs can clear useful explanations or show copy from the prior workflow step.

**How to apply:** Supply concise text through the common explanation API, use stable step IDs for the host's current task state, and let the SDK own only paging, collapse state, guide timing, and overlay rendering. Do not generate business instructions or alter host actions.

When the SDK constrains a registered flex-column scroll area, an unsafe `justify-content:center` can move oversized minimum-height content above the scrollport. Use safe centering for centered alignment and restore the host's original inline alignment when the viewport mode ends.

**Why:** An independent 1440×900 fixture reproduced a clipped first heading with the viewport starting at y=166 and a 780px minimum-height child; safe alignment kept the heading and final action reachable without scaling content.

**How to apply:** Apply this only to the registered scroll target, preserve its original inline alignment and priority, and test the title hit target plus bottom action under 60%, 70%, and 80% viewport modes. Keep host-specific dimensions and selectors out of the SDK.

Do not impose SDK-wide minimum font floors: scale the host-computed base size by the selected profile. Font reduction is limited to explicitly registered noncritical copy, tried at 5% then 10%, and judged against post-profile clipping/overlap measurements. Generic wrapping is allowed only inside explicitly registered reflow containers. Text-obscured diagnostics compare text with actual fixed/sticky action hitboxes or the QR dock button, never a decorative container; ignore parent/child action intersections.

**Why:** Generic text-wrap could undo an opted-in correction, hard floors would override the host's own responsive typography, and profile scaling changes line height. Parent rectangles also produce false overlap reports that hide real button occlusions.

**How to apply:** Register only noncritical supporting copy and safe reflow regions; report attempt percentages, residual issue types, and overlap measurements. Test 5%/10% success, rollback, unregistered copy, real button hitboxes, and style restoration in an independent browser fixture.

Smart Guide visibility has a separate 10-second default display timeout with a 15-second maximum; the profile's 10/15/20-second delay controls only when it first appears. In bottom-viewport mode, keep the fixed guide in the non-scrolling viewport band above the registered scroll area's top edge. Register only actions that must remain unobstructed, and include the current guide target as an obstacle.

**Why:** A real mobile-size browser run showed a bottom-viewport guide over a scrollable menu item when its safe area extended to the scroll area's bottom. Registering every ordinary button as a protected primary action can instead suppress useful guidance. Observer callbacks that react synchronously to SDK-owned emphasis changes can also amplify layout work.

**How to apply:** Keep the display lifetime distinct from the pre-display idle delay, cap configured display durations at 15 seconds, clear the overlay and emphasis on every dismissal path, and browser-test settled hit targets after scrolling at short/narrow viewports. Coalesce observer/scroll repositioning to one animation frame and exclude SDK-only mutations.

When reducing shared guidance-panel height, compress icon and control chrome rather than the explanatory text. Keep all pager, close, and fold controls at least 44×44 CSS px, and keep the decorative information mark out of the screen-reader name.

**Why:** The small-screen/large-type regression came from oversized controls and a standalone icon row, not from the explanatory copy; shrinking the copy would harm the users who need it most.

**How to apply:** Prefer a compact single-line header, preserve inherited profile-scaled body text and safe wrapping, and measure actual control rectangles at 320px widths in both normal and bottom-viewport modes.

The shared SDK owns only the completion countdown and its state notifications. The kiosk host decides when work is truly complete, owns all business data, and supplies the return-home callback; start the timer only after receipts, printing, or other final host work has finished.

**Why:** A generic accessibility SDK must not infer that a payment, application, or clinical workflow has completed, and its session reset cannot clear host-owned data by itself.

**How to apply:** Have the host signal a committed final-completion state, then use the SDK completion API for countdown/extension/cancel/finish. In the callback, clear host state and call `endSession()` before exposing the next user's welcome screen.

Smart Guide placement must be rechecked after host screen changes and guide-content resizing, using actual hit tests against registered primary actions. If the settled panel still blocks an action, hide it and report the suppression rather than trusting its earlier rectangle.

**Why:** A real browser hit test found the SDK panel covering a host action after the task view changed, even though the earlier placement had been accepted. Layout changes and content expansion can invalidate a previously safe position.

**How to apply:** Re-evaluate on relevant host DOM changes and guide-content changes, filter SDK-owned geometry/style mutations to prevent observer loops, and verify settled positions with `elementFromPoint` in a browser. Keep the host responsible for its actions; never work around an overlay by changing business logic or kiosk-specific CSS.

For a shared Easy Language/Smart Guide panel, keep its top anchor stable across copy, page, and mode changes within the same task step. The panel itself must not scroll; measure rendered Easy Language copy and paginate it without truncating, preferring sentence boundaries. Keep bottom scroll hints independent.

**Why:** A large difference in explanation height caused candidate placement to move the panel even though the task screen and safe area had not changed.

**How to apply:** Bound the panel before choosing its initial safe position, preserve that position while content changes, and test complete text traversal, page, fold, Smart Guide, and restoration transitions with real bounding-rectangle and hit-target measurements. Warn host authors about long explanations, but never silently truncate them.

When a protected action is inside a scrollport, placement and hit testing must use its rectangle clipped by the actual overflow ancestors; fully clipped controls are not visible obstacles. Nested scroll events must be observed in capture phase, and scrolling while Smart Guide is visible must not shorten its display lifetime. Reset easy-language page and fold state on a new task step, and let the fold control reopen a safety-collapsed panel.

**Why:** Actual mobile flows exposed false occlusion from offscreen child buttons, scroll-triggered guide dismissal, and stale/collapsed guidance across task steps; tight safe-area heights also need subpixel tolerance to avoid collapsing readable copy.

**How to apply:** Test the real host flow at short/narrow viewports with wheel and touch scroll, verify body and page controls remain visible when safe, and wait through the configured guide lifetime before confirming page/fold restoration.

While Smart Guide is visible, pointer/keyboard activity on the same task step may be counted but must neither dismiss the guide nor start a replacement idle timer. Only the fixed display deadline, explicit close, actual step transition, or session end may finish it. The scroll hint must coexist with Easy Language and Smart Guide whenever the active scroll owner has content below.

**Why:** The shared root listener treated every pointer/keyboard event as a dismissal, and the scroll cue was disabled for every guidance panel. A moving keypad obstacle also made the hint jump about 380px as its placement candidates changed.

**How to apply:** Keep `stepId` stable across same-screen value edits, let `notifyScreenChange()` identify committed screen/scroll-owner transitions, and keep the hint in one fixed viewport position while its owner can scroll. Make the hint noninteractive so underlying controls receive clicks. In a modal, use the topmost modal's scroll owner and never announce scrolling on the obscured page.

In normal viewport mode, keep the guide panel's previous viewport position while the same scroll owner moves; moving descendants must not force a new candidate. Fixed/sticky controls and real host-step or viewport changes may still require repositioning.

**Why:** The 320×844 and 390×844 standard-mode fixture showed 500px+ guide movement when visible keypad actions changed the placement candidates.

**How to apply:** Exclude moving scroll-content obstacles after the guide has a valid placement, allow pointer events to pass through the panel surface while retaining its own buttons, and verify `elementFromPoint` for host actions at start/middle/end. Hide the hint only when the active owner cannot scroll farther or no scroll owner exists.

Keep the scroll hint in the document layer and anchor it to the active scroll owner's visible client-bottom with one constant 12px inset. Do not move it to avoid buttons, keypads, cards, or QR docks; pointer transparency preserves interaction. Use the topmost registered modal's own scroll owner while a modal is open, and suppress background-page guidance.

**Why:** Obstacle-candidate placement moved the hint hundreds of pixels as controls changed; root transforms/stacking contexts also made fixed positioning depend on its DOM parent.

**How to apply:** Measure the actual scrollport client-bottom and hint bottom at top, middle, and end in each viewport mode. Confirm the 12px inset is stable while scrolling, the hint hides only at that owner's true end, modal hints follow modal scroll state, and `elementFromPoint` passes taps through. Convert transformed owner geometry to viewport coordinates and respond to `visualViewport` changes.
