export type MenuViewportClass = "compact" | "regular";
export type MenuTextScale = "standard" | "large" | "extraLarge";
export type MenuButtonScale = "standard" | "large";
export type MenuColumnCount = 1 | 2;

export type MenuLayoutOperation =
  | {
      type: "setGroupColumns";
      targetId: "menu.product-list";
      columns: MenuColumnCount;
    }
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
    };

export interface MenuLayoutConstraints {
  textScale: MenuTextScale;
  buttonScale: MenuButtonScale;
  highContrast: boolean;
  viewportModePercent: 60 | 70 | 80 | null;
  defaultColumns: MenuColumnCount;
  allowedColumns: readonly MenuColumnCount[];
  minimumTouchTargetPx: 44;
  preserveTopGuidance: true;
  preserveFixedControls: true;
}

export interface MenuScreenModel {
  schemaVersion: 2;
  hostId: "democoffee";
  screenId: "cafe.menu";
  structureVersion: "menu.v2";
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  groups: readonly {
    id: string;
    role: string;
    childIds: readonly string[];
    preserveOrder: boolean;
    mutableProperties: readonly string[];
  }[];
  requiredIds: readonly string[];
  protectedProperties: readonly string[];
  allowedOperations: readonly ("setGroupColumns" | "setGroupFlow" | "setChildBasis")[];
  constraints: MenuLayoutConstraints;
}

export interface MenuLayoutPlan {
  schemaVersion: 2;
  screenId: "cafe.menu";
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  operations: readonly MenuLayoutOperation[];
}

export interface ValidatedMenuLayout {
  structureHash: string;
  constraintHash: string;
  viewportClass: MenuViewportClass;
  columns: MenuColumnCount | null;
  gapPx: number | null;
  imageBasisPercent: number | null;
  imageMinimumPx: number | null;
}

const STRUCTURE = [
  "menu.v2",
  "menu.product-list:ordered-repeated-items:menu.product-card;mutable:columns;preserve:items,order",
  "menu.product-card:repeated-item:menu.product-image,menu.product-information;mutable:flow,gap;preserve:child-order",
  "menu.product-information:menu.product-name,menu.product-price,menu.product-description,menu.product-action",
  "dom-binding:data-menu-layout-id",
  "protected:menu.category-navigation,menu.fixed-controls,menu.product-content,menu.product-action.behavior",
  "operations:setGroupColumns,setGroupFlow,setChildBasis",
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
    easyLanguage?: boolean;
  },
): MenuScreenModel {
  const viewportClass: MenuViewportClass = viewportWidth <= 380 ? "compact" : "regular";
  const accessibilityForcesSingleColumn =
    (viewportWidth <= 700 && (profile.textSize !== "standard" || profile.buttonSize === "large")) ||
    (viewportWidth > 700 && viewportWidth <= 900 &&
      (profile.textSize === "extraLarge" || profile.buttonSize === "large"));
  const defaultColumns: MenuColumnCount =
    viewportClass === "compact" || accessibilityForcesSingleColumn ? 1 : 2;
  const allowedColumns: readonly MenuColumnCount[] =
    viewportClass === "compact" || accessibilityForcesSingleColumn ? [1] : [1, 2];
  const constraints: MenuLayoutConstraints = {
    textScale: profile.textSize,
    buttonScale: profile.buttonSize,
    highContrast: profile.contrast === "high",
    viewportModePercent: profile.viewportMode?.heightPercent ?? (profile.easyLanguage ? 80 : null),
    defaultColumns,
    allowedColumns,
    minimumTouchTargetPx: 44,
    preserveTopGuidance: true,
    preserveFixedControls: true,
  };
  const structureHash = hash(STRUCTURE);
  return {
    schemaVersion: 2,
    hostId: "democoffee",
    screenId: "cafe.menu",
    structureVersion: "menu.v2",
    structureHash,
    constraintHash: hash(JSON.stringify(constraints)),
    viewportClass,
    groups: [
      {
        id: "menu.product-list",
        role: "ordered-menu-list",
        childIds: ["menu.product-card"],
        preserveOrder: true,
        mutableProperties: ["columns"],
      },
      {
        id: "menu.product-card",
        role: "repeated-menu-item",
        childIds: ["menu.product-image", "menu.product-information"],
        preserveOrder: true,
        mutableProperties: ["flow", "gap"],
      },
      {
        id: "menu.product-information",
        role: "product-information",
        childIds: ["menu.product-name", "menu.product-price", "menu.product-description", "menu.product-action"],
        preserveOrder: true,
        mutableProperties: [],
      },
    ],
    requiredIds: [
      "menu.category-navigation",
      "menu.product-list",
      "menu.fixed-controls",
      "menu.product-action",
    ],
    protectedProperties: [
      "menu.product-list.items",
      "menu.product-list.order",
      "menu.category-navigation",
      "menu.fixed-controls",
      "menu.product-content",
      "menu.product-action.behavior",
    ],
    allowedOperations: ["setGroupColumns", "setGroupFlow", "setChildBasis"],
    constraints,
  };
}

export interface MockMenuLayoutOptions {
  columns?: MenuColumnCount | null;
  cardLayout?: boolean;
}

export function createMockMenuLayoutPlan(
  model: MenuScreenModel,
  options: MockMenuLayoutOptions = {},
): MenuLayoutPlan {
  const columns = options.columns === undefined ? 1 : options.columns;
  const cardLayout = options.cardLayout ?? true;
  const operations: MenuLayoutOperation[] = [];
  if (columns !== null) operations.push({
    type: "setGroupColumns",
    targetId: "menu.product-list",
    columns,
  });
  if (cardLayout) operations.push(
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
  );
  return {
    schemaVersion: 2,
    screenId: model.screenId,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations,
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
  if (plan.schemaVersion !== 2 ||
      plan.screenId !== model.screenId ||
      plan.structureHash !== model.structureHash ||
      plan.constraintHash !== model.constraintHash ||
      plan.viewportClass !== model.viewportClass ||
      !Array.isArray(plan.operations) ||
      plan.operations.length < 1 ||
      plan.operations.length > 3) return null;

  const parsed: {
    columns: MenuColumnCount | null;
    gapPx: number | null;
    imageBasisPercent: number | null;
    imageMinimumPx: number | null;
    operationOrder: number[];
  } = {
    columns: null,
    gapPx: null,
    imageBasisPercent: null,
    imageMinimumPx: null,
    operationOrder: [],
  };
  const order = { setGroupColumns: 0, setGroupFlow: 1, setChildBasis: 2 } as const;
  for (const operation of plan.operations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
    const item = operation as Record<string, unknown>;
    if (item.type === "setGroupColumns") {
      if (!exactKeys(item, ["type", "targetId", "columns"]) ||
          item.targetId !== "menu.product-list" ||
          (item.columns !== 1 && item.columns !== 2) ||
          !model.constraints.allowedColumns.includes(item.columns)) return null;
      parsed.columns = item.columns;
      parsed.operationOrder.push(order.setGroupColumns);
    } else if (item.type === "setGroupFlow") {
      if (!exactKeys(item, ["type", "targetId", "direction", "gapPx"]) ||
          item.targetId !== "menu.product-card" ||
          item.direction !== "row" ||
          typeof item.gapPx !== "number" ||
          !Number.isFinite(item.gapPx) ||
          item.gapPx < 8 || item.gapPx > 20) return null;
      parsed.gapPx = item.gapPx;
      parsed.operationOrder.push(order.setGroupFlow);
    } else if (item.type === "setChildBasis") {
      if (!exactKeys(item, ["type", "targetId", "basisPercent", "minPx"]) ||
          item.targetId !== "menu.product-image" ||
          typeof item.basisPercent !== "number" ||
          !Number.isFinite(item.basisPercent) ||
          item.basisPercent < 20 || item.basisPercent > 30 ||
          typeof item.minPx !== "number" ||
          !Number.isFinite(item.minPx) ||
          item.minPx < 72 || item.minPx > 96) return null;
      parsed.imageBasisPercent = item.basisPercent;
      parsed.imageMinimumPx = item.minPx;
      parsed.operationOrder.push(order.setChildBasis);
    } else {
      return null;
    }
  }

  if (new Set(parsed.operationOrder).size !== parsed.operationOrder.length ||
      parsed.operationOrder.some((value, index, values) => index > 0 && value <= values[index - 1])) return null;
  const hasFlow = parsed.gapPx !== null;
  const hasBasis = parsed.imageBasisPercent !== null;
  if (hasFlow !== hasBasis) return null;
  const effectiveColumns = parsed.columns ?? model.constraints.defaultColumns;
  if (hasFlow && effectiveColumns !== 1) return null;

  return {
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    columns: parsed.columns,
    gapPx: parsed.gapPx,
    imageBasisPercent: parsed.imageBasisPercent,
    imageMinimumPx: parsed.imageMinimumPx,
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
