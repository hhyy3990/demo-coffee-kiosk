---
name: Mockup preview dependencies
description: Diagnosing package-resolution failures in the workspace mockup sandbox.
---

When the mockup sandbox workflow reports unresolved imports, check its startup log and the workspace package resolution before restarting repeatedly. The artifact can be scaffolded before all of its preview dependencies are installed; packages installed for the workspace can then resolve from the sandbox.

**Why:** In this workspace, the sandbox started with a missing package import despite its workflow already being configured.

**How to apply:** Install only the dependencies named by the actual startup error through the package manager, then restart the sandbox workflow once.
