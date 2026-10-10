---
name: Chromium viewport emulation
description: Exact headless Chromium viewport sizing for kiosk browser tests.
---

Headless Chromium may clamp a narrow `--window-size` to a wider minimum, so the requested command-line width is not proof of the page's CSS viewport.

**Why:** kiosk UI validation needs exact widths such as 320px and 390px; the browser's actual `innerWidth` differed from the requested window width.

**How to apply:** set `Emulation.setDeviceMetricsOverride` over Chrome DevTools Protocol, then assert `innerWidth` and `innerHeight` before evaluating layout.
