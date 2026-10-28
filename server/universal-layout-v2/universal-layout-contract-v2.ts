import { z } from "zod";
import { universalSha256 } from "./universal-layout-contract.ts";

export const UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION = 2 as const;
export const UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION = "universal-layout.v2" as const;

export const UNIVERSAL_LAYOUT_V2_CAPABILITIES = [
  "reserved-bottom-controls",
] as const;
export type UniversalLayoutV2Capability = typeof UNIVERSAL_LAYOUT_V2_CAPABILITIES[number];
export type UniversalLayoutV2Viewport = "compact" | "regular" | "wide";

const accessSchema = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  viewportMode: z.union([
    z.null(),
    z.object({
      mode: z.literal("bottom"),
      heightPercent: z.union([z.literal(60), z.literal(70), z.literal(80)]),
    }).strict(),
  ]),
}).strict();

const componentSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  role: z.string().min(1),
  order: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  itemOrderHash: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(z.enum(["setColumns", "selectLayoutOption"])).min(1).max(2),
  allowedColumns: z.array(z.number().int().min(1).max(6)).min(1).max(6),
  optionGroups: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/),
    optionIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/)).min(1).max(100),
  }).strict()).min(1).max(32).optional(),
  minimumTouchTargetPx: z.number().int().min(44).max(96),
  protectedProperties: z.array(z.string().min(1)).min(1),
}).strict();

const modelSchema = z.object({
  schemaVersion: z.literal(UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION),
  contractVersion: z.literal(UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION),
  hostId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  screenId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
  structureVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{64}$/),
  viewportClass: z.enum(["compact", "regular", "wide"]),
  accessibility: accessSchema,
  layoutCapabilities: z.array(z.enum(UNIVERSAL_LAYOUT_V2_CAPABILITIES)).max(8),
  components: z.array(componentSchema).min(1).max(100),
  allowedOperations: z.array(z.enum(["setColumns", "selectLayoutOption"])).min(1).max(2),
}).strict().superRefine((model, context) => {
  const componentIds = new Set<string>();
  const orders = new Set<number>();
  for (const [index, component] of model.components.entries()) {
    if (componentIds.has(component.id)) {
      context.addIssue({ code: "custom", path: ["components", index, "id"], message: "DUPLICATE_COMPONENT_ID" });
    }
    if (orders.has(component.order)) {
      context.addIssue({ code: "custom", path: ["components", index, "order"], message: "DUPLICATE_COMPONENT_ORDER" });
    }
    if (new Set(component.allowedColumns).size !== component.allowedColumns.length) {
      context.addIssue({ code: "custom", path: ["components", index, "allowedColumns"], message: "DUPLICATE_COLUMN_VALUE" });
    }
    if (new Set(component.operations).size !== component.operations.length) {
      context.addIssue({ code: "custom", path: ["components", index, "operations"], message: "DUPLICATE_COMPONENT_OPERATION" });
    }
    if (component.optionGroups) {
      const groupIds = new Set<string>();
      for (const [groupIndex, group] of component.optionGroups.entries()) {
        if (groupIds.has(group.id)) {
          context.addIssue({
            code: "custom",
            path: ["components", index, "optionGroups", groupIndex, "id"],
            message: "DUPLICATE_OPTION_GROUP_ID",
          });
        }
        if (new Set(group.optionIds).size !== group.optionIds.length) {
          context.addIssue({
            code: "custom",
            path: ["components", index, "optionGroups", groupIndex, "optionIds"],
            message: "DUPLICATE_OPTION_ID",
          });
        }
        groupIds.add(group.id);
      }
    }
    componentIds.add(component.id);
    orders.add(component.order);
  }
  if (new Set(model.layoutCapabilities).size !== model.layoutCapabilities.length) {
    context.addIssue({ code: "custom", path: ["layoutCapabilities"], message: "DUPLICATE_LAYOUT_CAPABILITY" });
  }
  if (new Set(model.allowedOperations).size !== model.allowedOperations.length) {
    context.addIssue({ code: "custom", path: ["allowedOperations"], message: "DUPLICATE_ALLOWED_OPERATION" });
  }
});

const planSchema = z.object({
  schemaVersion: z.literal(UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION),
  contractVersion: z.literal(UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION),
  hostId: z.string(),
  screenId: z.string(),
  structureVersion: z.string(),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{64}$/),
  viewportClass: z.enum(["compact", "regular", "wide"]),
  operations: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("setColumns"),
      targetId: z.string().min(1),
      columns: z.number().int().min(1).max(6),
    }).strict(),
    z.object({
      type: z.literal("selectLayoutOption"),
      targetId: z.string().min(1),
      groupId: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/),
      optionId: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/),
    }).strict(),
  ])).min(1).max(20),
}).strict();

export type UniversalLayoutV2Model = z.infer<typeof modelSchema>;
export type UniversalLayoutV2Component = UniversalLayoutV2Model["components"][number];
export type UniversalLayoutV2Plan = z.infer<typeof planSchema>;
export type UniversalLayoutV2Operation = UniversalLayoutV2Plan["operations"][number];
export type UniversalLayoutV2Accessibility = z.infer<typeof accessSchema>;
export const universalLayoutV2ModelSchema = modelSchema;
export const universalLayoutV2PlanSchema = planSchema;

export type UniversalLayoutV2Policy = {
  hostId: string;
  screenId: string;
  structureVersion: string;
  allowedCapabilities: readonly UniversalLayoutV2Capability[];
  capabilityRules: Partial<Record<UniversalLayoutV2Capability, {
    componentIds: readonly string[];
    maximumColumns: number;
  }>>;
  components: readonly {
    id: string;
    kind: string;
    role: string;
    order: number;
    itemCountRange: readonly [number, number];
    allowedColumnsByViewport: Readonly<Record<UniversalLayoutV2Viewport, readonly number[]>>;
    singleColumnForLargeText: boolean;
    singleColumnForLargeButtons: boolean;
    singleColumnForHighContrast: boolean;
    singleColumnForBottomViewport: boolean;
    operations: readonly ["setColumns"];
    optionGroups?: readonly UniversalLayoutV2OptionGroupPolicy[];
    minimumTouchTargetPx: number;
    protectedProperties: readonly string[];
  }[];
};

/**
 * A policy-owned host preset identifier. This declares availability only; it
 * does not introduce an AI plan operation or encode CSS/style values.
 */
export type UniversalLayoutV2OptionDefinition = {
  id: string;
  requiresCapabilities?: readonly UniversalLayoutV2Capability[];
  excludesCapabilities?: readonly UniversalLayoutV2Capability[];
  accessibility?: Partial<{
    textScale: readonly UniversalLayoutV2Accessibility["textScale"][];
    buttonScale: readonly UniversalLayoutV2Accessibility["buttonScale"][];
    contrast: readonly UniversalLayoutV2Accessibility["contrast"][];
    viewportMode: readonly ("none" | "bottom-60" | "bottom-70" | "bottom-80")[];
  }>;
};

export type UniversalLayoutV2OptionGroupPolicy = {
  id: string;
  options: readonly UniversalLayoutV2OptionDefinition[];
};

export type UniversalLayoutV2OptionSelection = {
  componentId: string;
  groupId: string;
  optionId: string;
};

const optionSelectionSchema = z.object({
  componentId: z.string().min(1),
  groupId: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/),
  optionId: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/),
}).strict();
const optionSelectionsSchema = z.array(optionSelectionSchema).min(1).max(100);

export class UniversalLayoutV2ValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "UniversalLayoutV2ValidationError";
  }
}

function effectiveColumns(
  policy: UniversalLayoutV2Policy,
  component: UniversalLayoutV2Policy["components"][number],
  viewportClass: UniversalLayoutV2Viewport,
  accessibility: UniversalLayoutV2Accessibility,
  capabilities: readonly UniversalLayoutV2Capability[],
): number[] {
  let columns = [...component.allowedColumnsByViewport[viewportClass]];
  if (
    (component.singleColumnForLargeText && accessibility.textScale !== "standard") ||
    (component.singleColumnForLargeButtons && accessibility.buttonScale === "large") ||
    (component.singleColumnForHighContrast && accessibility.contrast === "high") ||
    (component.singleColumnForBottomViewport && accessibility.viewportMode !== null)
  ) columns = columns.filter((value) => value === 1);

  for (const capability of capabilities) {
    const rule = policy.capabilityRules[capability];
    if (rule?.componentIds.includes(component.id)) {
      columns = columns.filter((value) => value <= rule.maximumColumns);
    }
  }
  return columns;
}

function validateOptionGroupPolicy(policy: UniversalLayoutV2Policy): void {
  const allowedCapabilities = new Set(policy.allowedCapabilities);
  const idPattern = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

  for (const component of policy.components) {
    const groupIds = new Set<string>();
    for (const group of component.optionGroups ?? []) {
      if (!idPattern.test(group.id) || groupIds.has(group.id) || group.options.length === 0) {
        throw new UniversalLayoutV2ValidationError("INVALID_OPTION_POLICY");
      }
      groupIds.add(group.id);

      const optionIds = new Set<string>();
      for (const option of group.options) {
        if (!idPattern.test(option.id) || optionIds.has(option.id)) {
          throw new UniversalLayoutV2ValidationError("INVALID_OPTION_POLICY");
        }
        optionIds.add(option.id);
        const required = option.requiresCapabilities ?? [];
        const excluded = option.excludesCapabilities ?? [];
        if (
          new Set(required).size !== required.length ||
          new Set(excluded).size !== excluded.length ||
          required.some((capability) => !allowedCapabilities.has(capability)) ||
          excluded.some((capability) => !allowedCapabilities.has(capability)) ||
          required.some((capability) => excluded.includes(capability))
        ) {
          throw new UniversalLayoutV2ValidationError("INVALID_OPTION_POLICY");
        }
        const accessibilityOptions = option.accessibility;
        if (accessibilityOptions) {
          const allowedValues: Record<string, readonly string[]> = {
            textScale: ["standard", "large", "extraLarge"],
            buttonScale: ["standard", "large"],
            contrast: ["standard", "high"],
            viewportMode: ["none", "bottom-60", "bottom-70", "bottom-80"],
          };
          for (const [key, values] of Object.entries(accessibilityOptions)) {
            if (
              !values?.length ||
              new Set(values).size !== values.length ||
              values.some((value) => !allowedValues[key]?.includes(value))
            ) {
              throw new UniversalLayoutV2ValidationError("INVALID_OPTION_POLICY");
            }
          }
        }
      }
    }
  }
}

function effectiveOptionGroups(
  component: UniversalLayoutV2Policy["components"][number],
  capabilities: readonly UniversalLayoutV2Capability[],
  accessibility: UniversalLayoutV2Accessibility,
): { id: string; optionIds: string[] }[] {
  const activeCapabilities = new Set(capabilities);
  const viewportMode: "none" | "bottom-60" | "bottom-70" | "bottom-80" = accessibility.viewportMode === null
    ? "none"
    : `bottom-${accessibility.viewportMode.heightPercent}`;
  return (component.optionGroups ?? [])
    .map((group) => ({
      id: group.id,
      optionIds: group.options
        .filter((option) =>
          (option.requiresCapabilities ?? []).every((capability) => activeCapabilities.has(capability)) &&
          !(option.excludesCapabilities ?? []).some((capability) => activeCapabilities.has(capability)) &&
          (!option.accessibility?.textScale || option.accessibility.textScale.includes(accessibility.textScale)) &&
          (!option.accessibility?.buttonScale || option.accessibility.buttonScale.includes(accessibility.buttonScale)) &&
          (!option.accessibility?.contrast || option.accessibility.contrast.includes(accessibility.contrast)) &&
          (!option.accessibility?.viewportMode || option.accessibility.viewportMode.includes(viewportMode)),
        )
        .map((option) => option.id)
        .sort(),
    }))
    .filter((group) => group.optionIds.length > 0)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function structureHash(model: Pick<UniversalLayoutV2Model, "hostId" | "screenId" | "structureVersion" | "components">) {
  return universalSha256({
    schemaVersion: UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    components: [...model.components].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(
      ({ id, kind, role, order, itemCount, itemOrderHash }) => ({ id, kind, role, order, itemCount, itemOrderHash }),
    ),
  });
}

function constraintHash(model: Pick<UniversalLayoutV2Model,
  "viewportClass" | "accessibility" | "layoutCapabilities" | "components" | "allowedOperations">) {
  return universalSha256({
    schemaVersion: UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    layoutCapabilities: [...model.layoutCapabilities].sort(),
    allowedOperations: model.allowedOperations,
    components: [...model.components].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(
      ({ id, operations, allowedColumns, minimumTouchTargetPx, protectedProperties, optionGroups }) => ({
        id,
        operations,
        allowedColumns,
        minimumTouchTargetPx,
        protectedProperties,
        ...(optionGroups ? { optionGroups } : {}),
      }),
    ),
  });
}

export function computeUniversalLayoutV2StructureHash(
  model: Pick<UniversalLayoutV2Model, "hostId" | "screenId" | "structureVersion" | "components">,
): string {
  return structureHash(model);
}

export function computeUniversalLayoutV2ConstraintHash(
  model: Pick<UniversalLayoutV2Model,
    "viewportClass" | "accessibility" | "layoutCapabilities" | "components" | "allowedOperations">,
): string {
  return constraintHash(model);
}

export function createUniversalLayoutV2Model(
  policy: UniversalLayoutV2Policy,
  input: {
    viewportClass: UniversalLayoutV2Viewport;
    accessibility: UniversalLayoutV2Accessibility;
    layoutCapabilities: readonly UniversalLayoutV2Capability[];
    componentState: readonly { id: string; itemCount: number; itemOrderHash: string }[];
  },
): UniversalLayoutV2Model {
  validateOptionGroupPolicy(policy);
  if (!policy.components.length || new Set(policy.components.map((component) => component.id)).size !== policy.components.length ||
    new Set(policy.components.map((component) => component.order)).size !== policy.components.length ||
    new Set(input.componentState.map((state) => state.id)).size !== input.componentState.length ||
    new Set(policy.allowedCapabilities).size !== policy.allowedCapabilities.length) {
    throw new UniversalLayoutV2ValidationError("COMPONENT_POLICY_MISMATCH");
  }
  if (new Set(input.layoutCapabilities).size !== input.layoutCapabilities.length ||
    input.layoutCapabilities.some((capability) => {
      const rule = policy.capabilityRules[capability];
      return !policy.allowedCapabilities.includes(capability) || !rule ||
        !Number.isSafeInteger(rule.maximumColumns) || rule.maximumColumns < 1 || rule.maximumColumns > 6 ||
        !rule.componentIds.length ||
        rule.componentIds.some((id) => !policy.components.some((component) => component.id === id));
    })) {
    throw new UniversalLayoutV2ValidationError("UNSUPPORTED_LAYOUT_CAPABILITY");
  }
  if (input.componentState.length !== policy.components.length) {
    throw new UniversalLayoutV2ValidationError("COMPONENT_POLICY_MISMATCH");
  }
  const states = new Map(input.componentState.map((state) => [state.id, state]));
  const components = policy.components.map((component) => {
    const state = states.get(component.id);
    const allowedColumns = effectiveColumns(
      policy, component, input.viewportClass, input.accessibility, input.layoutCapabilities,
    );
    const optionGroups = effectiveOptionGroups(component, input.layoutCapabilities, input.accessibility);
    if (!state || state.itemCount < component.itemCountRange[0] ||
      state.itemCount > component.itemCountRange[1] || !/^[a-f0-9]{64}$/.test(state.itemOrderHash) ||
      !allowedColumns.length) {
      throw new UniversalLayoutV2ValidationError("COMPONENT_POLICY_MISMATCH");
    }
    const operations = [
      ...component.operations,
      ...(optionGroups.length ? ["selectLayoutOption" as const] : []),
    ];
    return {
      id: component.id, kind: component.kind, role: component.role, order: component.order,
      itemCount: state.itemCount, itemOrderHash: state.itemOrderHash,
      operations, allowedColumns,
      ...(optionGroups.length ? { optionGroups } : {}),
      minimumTouchTargetPx: component.minimumTouchTargetPx,
      protectedProperties: [...component.protectedProperties],
    };
  });
  const partial = {
    schemaVersion: UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
    hostId: policy.hostId, screenId: policy.screenId, structureVersion: policy.structureVersion,
    structureHash: "", constraintHash: "",
    viewportClass: input.viewportClass, accessibility: input.accessibility,
    layoutCapabilities: [...input.layoutCapabilities].sort(),
    components, allowedOperations: ["setColumns" as const],
  };
  const withStructure = { ...partial, structureHash: structureHash(partial) };
  const allowedOperations = [
    "setColumns" as const,
    ...(components.some((component) => component.operations.includes("selectLayoutOption"))
      ? ["selectLayoutOption" as const]
      : []),
  ];
  const withOperations = { ...withStructure, allowedOperations };
  return modelSchema.parse({ ...withOperations, constraintHash: constraintHash(withOperations) });
}

export function validateUniversalLayoutV2Model(
  value: unknown,
  policies: readonly UniversalLayoutV2Policy[],
): UniversalLayoutV2Model {
  const model = modelSchema.parse(value);
  const policy = policies.find((entry) => entry.hostId === model.hostId && entry.screenId === model.screenId);
  if (!policy) throw new UniversalLayoutV2ValidationError("UNSUPPORTED_HOST_SCREEN");
  if (model.structureVersion !== policy.structureVersion ||
    model.layoutCapabilities.some((capability) => !policy.allowedCapabilities.includes(capability)) ||
    new Set(model.layoutCapabilities).size !== model.layoutCapabilities.length) {
    throw new UniversalLayoutV2ValidationError("UNSUPPORTED_LAYOUT_CAPABILITY");
  }
  const expected = createUniversalLayoutV2Model(policy, {
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    layoutCapabilities: model.layoutCapabilities,
    componentState: model.components.map(({ id, itemCount, itemOrderHash }) => ({ id, itemCount, itemOrderHash })),
  });
  if (model.structureHash !== expected.structureHash) {
    throw new UniversalLayoutV2ValidationError("STRUCTURE_HASH_MISMATCH");
  }
  if (model.constraintHash !== expected.constraintHash) {
    throw new UniversalLayoutV2ValidationError("CONSTRAINT_HASH_MISMATCH");
  }
  if (JSON.stringify(model.components) !== JSON.stringify(expected.components)) {
    throw new UniversalLayoutV2ValidationError("COMPONENT_POLICY_MISMATCH");
  }
  return model;
}

export function validateUniversalLayoutV2Plan(
  value: unknown,
  modelValue: unknown,
  policies: readonly UniversalLayoutV2Policy[],
): UniversalLayoutV2Plan {
  const model = validateUniversalLayoutV2Model(modelValue, policies);
  const plan = planSchema.parse(value);
  if (
    plan.schemaVersion !== model.schemaVersion || plan.contractVersion !== model.contractVersion ||
    plan.hostId !== model.hostId || plan.screenId !== model.screenId ||
    plan.structureVersion !== model.structureVersion || plan.structureHash !== model.structureHash ||
    plan.constraintHash !== model.constraintHash || plan.viewportClass !== model.viewportClass
  ) throw new UniversalLayoutV2ValidationError("PLAN_MODEL_MISMATCH");
  const setColumnsTargets = new Set<string>();
  const optionSelections: UniversalLayoutV2OptionSelection[] = [];
  for (const operation of plan.operations) {
    const component = model.components.find((entry) => entry.id === operation.targetId);
    if (!component) throw new UniversalLayoutV2ValidationError("UNSUPPORTED_PLAN_OPERATION");
    if (!model.allowedOperations.includes(operation.type) || !component.operations.includes(operation.type)) {
      throw new UniversalLayoutV2ValidationError("UNSUPPORTED_PLAN_OPERATION");
    }
    if (operation.type === "setColumns") {
      if (
        setColumnsTargets.has(operation.targetId) ||
        optionSelections.some((selection) => selection.componentId === operation.targetId)
      ) {
        throw new UniversalLayoutV2ValidationError("CONFLICTING_OPERATION_TARGET");
      }
      setColumnsTargets.add(operation.targetId);
      if (!component.allowedColumns.includes(operation.columns)) {
        throw new UniversalLayoutV2ValidationError("DISALLOWED_COLUMN_COUNT");
      }
    } else {
      if (setColumnsTargets.has(operation.targetId)) {
        throw new UniversalLayoutV2ValidationError("CONFLICTING_OPERATION_TARGET");
      }
      optionSelections.push({
        componentId: operation.targetId,
        groupId: operation.groupId,
        optionId: operation.optionId,
      });
    }
  }
  if (optionSelections.length) {
    validateUniversalLayoutV2OptionSelections(optionSelections, model, policies);
  }
  return plan;
}

export function parseUniversalLayoutV2Plan(value: unknown): UniversalLayoutV2Plan {
  return planSchema.parse(value);
}

/**
 * Validates one internal choice against policy-resolved option declarations.
 * The plan operation maps to this selector but retains its own strict wire shape.
 */
export function validateUniversalLayoutV2OptionSelection(
  value: unknown,
  modelValue: unknown,
  policies: readonly UniversalLayoutV2Policy[],
): UniversalLayoutV2OptionSelection {
  const model = validateUniversalLayoutV2Model(modelValue, policies);
  const selection = optionSelectionSchema.safeParse(value);
  if (!selection.success) {
    throw new UniversalLayoutV2ValidationError("INVALID_OPTION_SELECTION");
  }

  const component = model.components.find((entry) => entry.id === selection.data.componentId);
  const group = component?.optionGroups?.find((entry) => entry.id === selection.data.groupId);
  if (!group?.optionIds.includes(selection.data.optionId)) {
    throw new UniversalLayoutV2ValidationError("UNSUPPORTED_OPTION_SELECTION");
  }
  return selection.data;
}

/**
 * Validates a set of internal option choices. A component/group can be chosen
 * only once, so duplicate and conflicting choices cannot reach an applier.
 * This is not a wire-level AI plan schema.
 */
export function validateUniversalLayoutV2OptionSelections(
  value: unknown,
  modelValue: unknown,
  policies: readonly UniversalLayoutV2Policy[],
): UniversalLayoutV2OptionSelection[] {
  const model = validateUniversalLayoutV2Model(modelValue, policies);
  const selections = optionSelectionsSchema.safeParse(value);
  if (!selections.success) {
    throw new UniversalLayoutV2ValidationError("INVALID_OPTION_SELECTIONS");
  }

  const selectedByGroup = new Map<string, string>();
  for (const selection of selections.data) {
    const groupKey = `${selection.componentId}\u0000${selection.groupId}`;
    const existingOption = selectedByGroup.get(groupKey);
    if (existingOption !== undefined) {
      throw new UniversalLayoutV2ValidationError(
        existingOption === selection.optionId
          ? "DUPLICATE_OPTION_SELECTION"
          : "CONFLICTING_OPTION_SELECTION",
      );
    }
    selectedByGroup.set(groupKey, selection.optionId);

    const component = model.components.find((entry) => entry.id === selection.componentId);
    const group = component?.optionGroups?.find((entry) => entry.id === selection.groupId);
    if (!group?.optionIds.includes(selection.optionId)) {
      throw new UniversalLayoutV2ValidationError("UNSUPPORTED_OPTION_SELECTION");
    }
  }
  return selections.data;
}
