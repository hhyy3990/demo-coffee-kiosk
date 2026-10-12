---
name: Chromium viewport emulation
description: Exact headless Chromium viewport sizing for kiosk browser tests.
---

Headless Chromium may clamp a narrow `--window-size` to a wider minimum, so the requested command-line width is not proof of the page's CSS viewport.

**Why:** kiosk UI validation needs exact widths such as 320px and 390px; the browser's actual `innerWidth` differed from the requested window width.

**How to apply:** set `Emulation.setDeviceMetricsOverride` over Chrome DevTools Protocol, then assert `innerWidth` and `innerHeight` before evaluating layout.

For mobile scroll tests, device metrics alone do not establish a touchscreen interaction path. Enable CDP touch emulation (`Emulation.setTouchEmulationEnabled`, `maxTouchPoints: 1`) and dispatch a sequence of input moves; track `scrollTop` until it is stable before judging the result. Keep programmatic maximum-scroll checks separate from user-input checks.

**Why:** automated wheel input at mobile CSS widths failed to represent a touch swipe, while a forced scroll position could appear correct immediately and then change after the input settled.

**How to apply:** use touch emulation for narrow viewports, record scroll events and positions before/after settling, then run a separate forced-scroll diagnostic without counting it as user access.
