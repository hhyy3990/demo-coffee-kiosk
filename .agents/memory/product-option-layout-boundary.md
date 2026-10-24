---
name: Product option layout boundary
description: Contract and safety rule for layout-only changes on DemoCoffee's product-options screen.
---

Product-option layouts use a distinct screen contract (`cafe.product-options`), separate from the menu's `menu.v2` contract. Only option-choice button columns are mutable; option contents, order, selected state, required rules, price, quantity, cart, navigation, and payment behavior remain host-owned.

**Why:** The options screen is part of an order transaction, so reusing the menu contract or allowing generated plans to alter business state would widen the trusted surface unnecessarily.

**How to apply:** Validate any future option plan against its own structure and accessibility constraints, fail closed to the existing screen, and prove React/CSS application separately from plan validation. Keep real Central AI connectivity out of Mock-only testing.
