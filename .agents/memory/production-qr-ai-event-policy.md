---
name: Production QR AI event policy
description: User-approved rules for Production AI attempts triggered by DemoCoffee G QR applications.
---

Each explicit application of a G QR profile creates a new Production AI opportunity, even when the same QR/model was applied previously. Retransmissions, duplicate clicks, and React rerenders for one application must reuse that application's event identity and must not trigger another provider call. A page reload alone must never launch a new AI request. QR access preferences remain active when the AI request fails or a quota is exhausted.

Use a browser-generated UUIDv4 as the event identity, validate its format server-side, and use it as the Production idempotency key. Do not include QR tokens, admin keys, personal information, or service credentials in the key. Persist the attempted marker in tab session storage before sending so a reload cannot replay the same application. Only a new explicit QR application creates a new event ID.

The central provider-call quota is 50 and is centrally enforced; do not alter it from this host repository.

**Why:** The same model may receive a new provider-call opportunity for a new user's explicit QR application, while duplicate delivery of one application must remain idempotent and refresh must not count as a new application.

**How to apply:** Keep this policy Production-only. Do not change Development AI routes, the G model contract, existing QR auto-run eligibility, post-response layout safety checks, or no-retry behavior unless the user explicitly changes those requirements.
