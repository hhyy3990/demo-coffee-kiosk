import type {
  UniversalLayoutV2Policy,
  UniversalLayoutV2Viewport,
} from "./universal-v2-contract-export.js";

/**
 * Production allowlist candidate for DemoCoffee's QR-driven menu layout.
 * Keep this separate from the Development conformance fixture.
 */
export const demoCoffeeUniversalV2ProductionPolicy: UniversalLayoutV2Policy = {
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
    itemCountRange: [5, 5],
    allowedColumnsByViewport: { compact: [1], regular: [1], wide: [1] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: true,
    singleColumnForBottomViewport: true,
    operations: ["setColumns"],
    optionGroups: [{
      id: "arrangement",
      options: [{
        id: "single-column-list",
        accessibility: {
          textScale: ["large"],
          buttonScale: ["large"],
          contrast: ["high"],
          viewportMode: ["bottom-70"],
        },
      }],
    }],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};

export function demoCoffeeUniversalV2ProductionPolicyForViewport(
  viewportClass: UniversalLayoutV2Viewport,
): UniversalLayoutV2Policy | null {
  return viewportClass === "compact" || viewportClass === "regular"
    ? demoCoffeeUniversalV2ProductionPolicy
    : null;
}
