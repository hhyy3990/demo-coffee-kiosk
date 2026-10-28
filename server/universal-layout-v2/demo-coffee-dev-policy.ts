import type { UniversalLayoutV2Policy } from "./universal-v2-contract-export.js";

/**
 * Development conformance policy only. This does not claim central registration.
 * The CSS preset itself remains host-owned and is not represented in the plan.
 */
export const demoCoffeeUniversalV2DevPolicy: UniversalLayoutV2Policy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  allowedCapabilities: [],
  capabilityRules: {},
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [{
        id: "compact-grid",
        accessibility: {
          textScale: ["standard"],
          buttonScale: ["standard"],
        },
      }],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};
