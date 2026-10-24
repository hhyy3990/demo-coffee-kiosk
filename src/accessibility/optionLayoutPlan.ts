export type OptionLayoutColumns = 1 | 2;
export type OptionLayoutViewportClass = "compact" | "regular";
export type OptionGroupId = "temperature" | "size" | "cup";

export interface OptionLayoutConstraints {
  textScale: "standard" | "large" | "extraLarge";
  buttonScale: "standard" | "large";
  highContrast: boolean;
  viewportModePercent: 60 | 70 | 80 | null;
  defaultColumns: OptionLayoutColumns;
  allowedColumns: readonly OptionLayoutColumns[];
  minimumTouchTargetPx: 44;
}

export interface OptionScreenModel {
  schemaVersion: 1;
  hostId: "democoffee";
  screenId: "cafe.product-options";
  structureVersion: "options.v1";
  structureHash: string;
  constraintHash: string;
  viewportClass: OptionLayoutViewportClass;
  groups: readonly {
    id: OptionGroupId;
    role: "single-choice-group";
    preserveOrder: true;
    preserveSelection: true;
  }[];
  constraints: OptionLayoutConstraints;
}

export interface OptionLayoutPlan {
  schemaVersion: 1;
  screenId: "cafe.product-options";
  structureHash: string;
  constraintHash: string;
  viewportClass: OptionLayoutViewportClass;
  operations: readonly [{
    type: "setChoiceColumns";
    targetId: "options.choice-groups";
    columns: OptionLayoutColumns;
  }];
}

export interface ValidatedOptionLayout {
  screenId: "cafe.product-options";
  structureHash: string;
  constraintHash: string;
  viewportClass: OptionLayoutViewportClass;
  columns: OptionLayoutColumns;
}

const STRUCTURE_VERSION = "options.v1";
const STRUCTURE = [
  "options.v1",
  "options.choice-groups:single-choice-buttons;mutable:columns;preserve:labels,order,selection",
  "protected:product-content,option-values,required-rules,prices,quantity,cart,actions,navigation",
  "operations:setChoiceColumns",
].join("|");

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      actual.every((value, index) => sameValue(value, expected[index]));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) =>
        key === expectedKeys[index] && sameValue(actual[key], expected[key]),
      );
  }
  return actual === expected;
}

export function createOptionScreenModel(
  viewportWidth: number,
  profile: {
    textSize: "standard" | "large" | "extraLarge";
    buttonSize: "standard" | "large";
    contrast: "standard" | "high";
    viewportMode: { heightPercent: 60 | 70 | 80 } | null;
    easyLanguage?: boolean;
  },
  groupIds: readonly OptionGroupId[],
): OptionScreenModel {
  const viewportClass: OptionLayoutViewportClass = viewportWidth <= 380 ? "compact" : "regular";
  const accessibilityForcesSingleColumn =
    (viewportWidth <= 700 && (profile.textSize !== "standard" || profile.buttonSize === "large")) ||
    (viewportWidth > 700 && viewportWidth <= 900 &&
      (profile.textSize === "extraLarge" || profile.buttonSize === "large"));
  const allowedColumns: readonly OptionLayoutColumns[] =
    viewportClass === "compact" || accessibilityForcesSingleColumn ? [1] : [1, 2];
  const constraints: OptionLayoutConstraints = {
    textScale: profile.textSize,
    buttonScale: profile.buttonSize,
    highContrast: profile.contrast === "high",
    viewportModePercent: profile.viewportMode?.heightPercent ?? (profile.easyLanguage ? 80 : null),
    defaultColumns: allowedColumns.includes(2) ? 2 : 1,
    allowedColumns,
    minimumTouchTargetPx: 44,
  };
  const groups = [...new Set(groupIds)].map((id) => ({
    id,
    role: "single-choice-group" as const,
    preserveOrder: true as const,
    preserveSelection: true as const,
  }));
  return {
    schemaVersion: 1,
    hostId: "democoffee",
    screenId: "cafe.product-options",
    structureVersion: STRUCTURE_VERSION,
    structureHash: hash(`${STRUCTURE}|groups:${groups.map(({ id }) => id).join(",")}`),
    constraintHash: hash(JSON.stringify(constraints)),
    viewportClass,
    groups,
    constraints,
  };
}

export function validateOptionScreenModel(input: unknown): OptionScreenModel | null {
  if (!isRecord(input) ||
      (input.viewportClass !== "compact" && input.viewportClass !== "regular") ||
      !isRecord(input.constraints) ||
      !Array.isArray(input.groups)) return null;

  const validGroupIds = new Set<OptionGroupId>(["temperature", "size", "cup"]);
  const groupIds: OptionGroupId[] = [];
  for (const group of input.groups) {
    if (!isRecord(group) ||
        !validGroupIds.has(group.id as OptionGroupId)) return null;
    groupIds.push(group.id as OptionGroupId);
  }
  if (new Set(groupIds).size !== groupIds.length ||
      !["standard", "large", "extraLarge"].includes(String(input.constraints.textScale)) ||
      !["standard", "large"].includes(String(input.constraints.buttonScale)) ||
      typeof input.constraints.highContrast !== "boolean") return null;

  const viewportModePercent = input.constraints.viewportModePercent;
  if (viewportModePercent !== null &&
      viewportModePercent !== 60 && viewportModePercent !== 70 && viewportModePercent !== 80) return null;

  const expected = createOptionScreenModel(
    input.viewportClass === "compact" ? 360 : 390,
    {
      textSize: input.constraints.textScale as OptionLayoutConstraints["textScale"],
      buttonSize: input.constraints.buttonScale as OptionLayoutConstraints["buttonScale"],
      contrast: input.constraints.highContrast ? "high" : "standard",
      viewportMode: viewportModePercent === null
        ? null
        : { heightPercent: viewportModePercent as 60 | 70 | 80 },
    },
    groupIds,
  );
  return sameValue(input, expected) ? expected : null;
}

export function createMockOptionLayoutPlan(
  model: OptionScreenModel,
  columns: OptionLayoutColumns,
): OptionLayoutPlan {
  return {
    schemaVersion: 1,
    screenId: model.screenId,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{
      type: "setChoiceColumns",
      targetId: "options.choice-groups",
      columns,
    }],
  };
}

export function validateOptionLayoutPlan(
  input: unknown,
  model: OptionScreenModel,
): ValidatedOptionLayout | null {
  if (!isRecord(input) || !exactKeys(input, [
    "schemaVersion", "screenId", "structureHash", "constraintHash", "viewportClass", "operations",
  ])) return null;
  if (input.schemaVersion !== 1 ||
      input.screenId !== model.screenId ||
      input.structureHash !== model.structureHash ||
      input.constraintHash !== model.constraintHash ||
      input.viewportClass !== model.viewportClass ||
      !Array.isArray(input.operations) ||
      input.operations.length !== 1) return null;
  const operation = input.operations[0];
  if (!isRecord(operation) || !exactKeys(operation, ["type", "targetId", "columns"]) ||
      operation.type !== "setChoiceColumns" ||
      operation.targetId !== "options.choice-groups" ||
      (operation.columns !== 1 && operation.columns !== 2) ||
      !model.constraints.allowedColumns.includes(operation.columns)) return null;
  return {
    screenId: model.screenId,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    columns: operation.columns,
  };
}
