---
name: Menu layout diagnostic evidence
description: Which evidence is available when inspecting automatic menu layout attempts.
---

Browser-side diagnostic history is held in the page's JavaScript memory. Workflow logs show server relay events, but do not establish whether the client trigger ran or React applied a plan.

**Why:** An actual attempt had a local `model_rejected` server event and Vite WebSocket errors, but no accessible client diagnostic history; attributing that request to the QR-triggered flow would have been speculation.

**How to apply:** Capture safe browser diagnostic events and DOM/CSS measurements before a reload or Workflow restart. If client history is unavailable, report server facts separately and do not infer React or CSS success from HTTP status alone.
