import type {
  UniversalLayoutV2Policy,
  UniversalLayoutV2Viewport,
} from "./universal-v2-contract-export.js";

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
      }, {
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

/**
 * The G option has local central-hash evidence only for compact and regular
 * viewports. Keep it out of wider models until that viewport is verified.
 */
export function demoCoffeeUniversalV2PolicyForViewport(
  viewportClass: UniversalLayoutV2Viewport,
): UniversalLayoutV2Policy {
  if (viewportClass !== "wide") return demoCoffeeUniversalV2DevPolicy;
  return {
    ...demoCoffeeUniversalV2DevPolicy,
    components: demoCoffeeUniversalV2DevPolicy.components.map((component) => ({
      ...component,
      optionGroups: component.optionGroups?.map((group) => ({
        ...group,
        options: group.options.filter((option) => option.id !== "single-column-list"),
      })),
    })),
  };
}
