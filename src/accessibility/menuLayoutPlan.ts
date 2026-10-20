export type MenuViewportClass = "compact" | "regular";
export type MenuTextScale = "standard" | "large" | "extraLarge";
export type MenuButtonScale = "standard" | "large";

export interface MenuLayoutConstraints {
  textScale: MenuTextScale;
  buttonScale: MenuButtonScale;
  highContrast: boolean;
  viewportModePercent: 60 | 70 | 80 | null;
  minimumTouchTargetPx: 44;
  preserveTopGuidance: true;
  preserveFixedControls: true;
}

export interface MenuScreenModel {
  schemaVersion: 1;
  hostId: "democoffee";
  screenId: "cafe.menu";
  structureVersion: "menu.v1";
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  groups: readonly {
    id: string;
    role: string;
    childIds: readonly string[];
    preserveOrder: boolean;
  }[];
  requiredIds: readonly string[];
  allowedOperations: readonly string[];
  constraints: MenuLayoutConstraints;
}

export interface MenuLayoutPlan {
  schemaVersion: 1;
  screenId: "cafe.menu";
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  operations: readonly (
    | {
        type: "setGroupFlow";
        targetId: "menu.product-card";
        direction: "row";
        gapPx: number;
      }
    | {
        type: "setChildBasis";
        targetId: "menu.product-image";
        basisPercent: number;
        minPx: number;
      }
  )[];
}

export interface ValidatedMenuLayout {
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  gapPx: number;
  imageBasisPercent: number;
  imageMinimumPx: number;
}

const STRUCTURE = [
  "menu.v1",
  "menu.product-card:repeated-item:menu.product-image,menu.product-information",
  "menu.product-information:menu.product-name,menu.product-price,menu.product-description,menu.product-action",
  "preserve-item-order",
  "protected:menu.category-navigation,menu.product-list,menu.fixed-controls",
  "operations:setGroupFlow,setChildBasis",
].join("|");

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function createMenuScreenModel(
  viewportWidth: number,
  profile: {
    textSize: MenuTextScale;
    buttonSize: MenuButtonScale;
    contrast: "standard" | "high";
    viewportMode: { heightPercent: 60 | 70 | 80 } | null;
  },
): MenuScreenModel {
  const constraints: MenuLayoutConstraints = {
    textScale: profile.textSize,
    buttonScale: profile.buttonSize,
    highContrast: profile.contrast === "high",
    viewportModePercent: profile.viewportMode?.heightPercent ?? null,
    minimumTouchTargetPx: 44,
    preserveTopGuidance: true,
    preserveFixedControls: true,
  };
  return {
    schemaVersion: 1,
    hostId: "democoffee",
    screenId: "cafe.menu",
    structureVersion: "menu.v1",
    structureHash: hash(STRUCTURE),
    constraintHash: hash(JSON.stringify(constraints)),
    viewportClass: viewportWidth <= 380 ? "compact" : "regular",
    groups: [
      {
        id: "menu.product-card",
        role: "repeated-menu-item",
        childIds: ["menu.product-image", "menu.product-information"],
        preserveOrder: true,
      },
      {
        id: "menu.product-information",
        role: "product-information",
        childIds: ["menu.product-name", "menu.product-price", "menu.product-description", "menu.product-action"],
        preserveOrder: true,
      },
    ],
    requiredIds: [
      "menu.category-navigation",
      "menu.product-list",
      "menu.fixed-controls",
      "menu.product-action",
    ],
    allowedOperations: ["setGroupFlow", "setChildBasis"],
    constraints,
  };
}

export function createMockMenuLayoutPlan(model: MenuScreenModel): MenuLayoutPlan {
  return {
    schemaVersion: 1,
    screenId: model.screenId,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [
      {
        type: "setGroupFlow",
        targetId: "menu.product-card",
        direction: "row",
        gapPx: 12,
      },
      {
        type: "setChildBasis",
        targetId: "menu.product-image",
        basisPercent: 25,
        minPx: 76,
      },
    ],
  };
}

export function validateMenuLayoutPlan(
  input: unknown,
  model: MenuScreenModel,
): ValidatedMenuLayout | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const plan = input as Record<string, unknown>;
  if (!exactKeys(plan, [
    "schemaVersion", "screenId", "structureHash", "constraintHash", "viewportClass", "operations",
  ])) return null;
  if (plan.schemaVersion !== 1 ||
      plan.screenId !== model.screenId ||
      plan.structureHash !== model.structureHash ||
      plan.constraintHash !== model.constraintHash ||
      plan.viewportClass !== model.viewportClass ||
      !Array.isArray(plan.operations) ||
      plan.operations.length !== 2) return null;

  const [flow, basis] = plan.operations;
  if (!flow || typeof flow !== "object" || Array.isArray(flow) ||
      !basis || typeof basis !== "object" || Array.isArray(basis)) return null;
  const flowOperation = flow as Record<string, unknown>;
  const basisOperation = basis as Record<string, unknown>;

  if (!exactKeys(flowOperation, ["type", "targetId", "direction", "gapPx"]) ||
      flowOperation.type !== "setGroupFlow" ||
      flowOperation.targetId !== "menu.product-card" ||
      flowOperation.direction !== "row" ||
      typeof flowOperation.gapPx !== "number" ||
      !Number.isFinite(flowOperation.gapPx) ||
      flowOperation.gapPx < 8 || flowOperation.gapPx > 20) return null;

  if (!exactKeys(basisOperation, ["type", "targetId", "basisPercent", "minPx"]) ||
      basisOperation.type !== "setChildBasis" ||
      basisOperation.targetId !== "menu.product-image" ||
      typeof basisOperation.basisPercent !== "number" ||
      !Number.isFinite(basisOperation.basisPercent) ||
      basisOperation.basisPercent < 20 || basisOperation.basisPercent > 30 ||
      typeof basisOperation.minPx !== "number" ||
      !Number.isFinite(basisOperation.minPx) ||
      basisOperation.minPx < 72 || basisOperation.minPx > 96) return null;

  return {
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    gapPx: flowOperation.gapPx,
    imageBasisPercent: basisOperation.basisPercent,
    imageMinimumPx: basisOperation.minPx,
  };
}

export interface MenuPlanTicket {
  generation: number;
  screenId: MenuScreenModel["screenId"];
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
}

export function createMenuPlanGate() {
  let generation = 0;
  return {
    invalidate(): number {
      generation += 1;
      return generation;
    },
    capture(model: MenuScreenModel): MenuPlanTicket {
      return {
        generation,
        screenId: model.screenId,
        structureHash: model.structureHash,
        constraintHash: model.constraintHash,
        viewportClass: model.viewportClass,
      };
    },
    canApply(ticket: MenuPlanTicket, model: MenuScreenModel): boolean {
      return ticket.generation === generation &&
        ticket.screenId === model.screenId &&
        ticket.structureHash === model.structureHash &&
        ticket.constraintHash === model.constraintHash &&
        ticket.viewportClass === model.viewportClass;
    },
  };
}
