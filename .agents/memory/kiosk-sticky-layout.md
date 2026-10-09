---
name: Kiosk sticky navigation
description: Preserve sticky menu controls while preventing horizontal overflow in narrow kiosk layouts.
---

Avoid `overflow-x: hidden` on the root scrolling page when category and menu controls rely on `position: sticky`; it can create a scroll container that prevents the sticky controls from tracking viewport scrolling. Use clipping that does not create a scroll container, and size horizontally extended category rails to the shell's actual narrow-screen gutter.

**Why:** Responsive browser checks showed the simplified-menu toolbar scrolling out of view, which also caused its active-menu index to reset. Removing the scroll-container behavior fixed sticky navigation; a separate 320px gutter adjustment prevented the category rail from extending past the viewport.

**How to apply:** When changing sticky category/menu controls or horizontal overflow rules, test both sticky element positions and page/body widths at 320px and other target kiosk widths.
