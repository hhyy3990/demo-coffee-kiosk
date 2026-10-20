---
name: Fictional kiosk brand scope
description: Brand and visual-reference constraints for the café kiosk.
---

Use “데모커피 / DEMO COFFEE” as the fictional café identity. The attached kiosk photos are references for screen structure only; do not reuse real café names, logos, trademarks, or distinctive brand elements.

**Why:** The user explicitly requested a brand-independent café demo rather than a reproduction of a commercial kiosk.

**How to apply:** Use generic coffee imagery, icons, and copy in kiosk screens and mockups. Keep photo references limited to layout and interaction patterns.

For this project, DemoCoffee may use a development/test-injected mock screen-layout plan in the host only. Do not call the central AI server, use a real AI provider, modify the central QR service or SDK, or publish without separate explicit approval.

**Why:** The user approved a DemoCoffee-only mock layout transformation while explicitly deferring central policy registration and real AI connection to a later approval.

**How to apply:** Keep mock injection development/test-only, render validated layout plans through the host React tree, preserve host business behavior and SDK accessibility state, and wait for separate approval before central-server, real-AI, SDK, or publishing work.

For DemoCoffee menu plans, only the list column count and the card's image/information flow, image basis, and gap may change. Preserve product membership, order, category navigation, names, prices, descriptions, selection behavior, and fixed/accessibility controls.

**Why:** The user explicitly approved column count as a narrowly scoped exception to list protection and prohibited changes to menu content or ordering.

**How to apply:** Represent every permitted visual change as an allow-listed operation, bind semantic IDs to the host React elements, and reject plans that violate viewport/profile constraints or introduce SDK layout diagnostics.

For approved DemoCoffee Development relay tests, pass Replit External Access Token only as the `project-protection-bypass` URL parameter and the central app service token only as `Authorization: Bearer`. Do not use URL-token auth as a Production pattern.

**Why:** The supplied Replit Development guide identifies the supported split-auth mechanism while limiting this higher-risk URL-token method to Development connection tests.

**How to apply:** Keep both values server-side, build the query with URL/URLSearchParams, reject configured URLs that already contain a query, never log the resulting URL, and require explicit relay enablement plus a `.replit.dev` HTTPS destination.
