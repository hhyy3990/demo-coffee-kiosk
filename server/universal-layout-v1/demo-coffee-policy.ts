import type { UniversalLayoutPolicy } from "./universal-layout-contract.js";

// Exact DemoCoffee fixture currently used by the central Universal v1 tests.
// This is a host-side mock policy, not active central API registration.
export const demoCoffeeMenuPolicy: UniversalLayoutPolicy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    operations: ["setColumns"],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};
