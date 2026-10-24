import { createHash } from "node:crypto";
import { z } from "zod";

export const UNIVERSAL_LAYOUT_SCHEMA_VERSION = 1 as const;
export const UNIVERSAL_LAYOUT_CONTRACT_VERSION = "universal-layout.v1" as const;

const accessibilitySchema = z.object({
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
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  kind: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  order: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  itemOrderHash: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(z.literal("setColumns")).min(1).max(1),
  allowedColumns: z.array(z.number().int().min(1).max(6)).min(1).max(6),
  minimumTouchTargetPx: z.number().int().min(44).max(96),
  protectedProperties: z.array(z.string().min(1).max(64)).min(1).max(32),
}).strict();

export const universalLayoutModelSchema = z.object({
  schemaVersion: z.literal(UNIVERSAL_LAYOUT_SCHEMA_VERSION),
  contractVersion: z.literal(UNIVERSAL_LAYOUT_CONTRACT_VERSION),
  hostId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  screenId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
  structureVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{64}$/),
  viewportClass: z.enum(["compact", "regular", "wide"]),
  accessibility: accessibilitySchema,
  components: z.array(componentSchema).min(1).max(100),
  allowedOperations: z.array(z.literal("setColumns")).min(1).max(1),
}).strict().superRefine((model, ctx) => {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const [index, component] of model.components.entries()) {
    if (ids.has(component.id)) {
      ctx.addIssue({ code: "custom", path: ["components", index, "id"], message: "DUPLICATE_COMPONENT_ID" });
    }
    if (orders.has(component.order)) {
      ctx.addIssue({ code: "custom", path: ["components", index, "order"], message: "DUPLICATE_COMPONENT_ORDER" });
    }
    if (new Set(component.allowedColumns).size !== component.allowedColumns.length) {
      ctx.addIssue({ code: "custom", path: ["components", index, "allowedColumns"], message: "DUPLICATE_COLUMN_VALUE" });
    }
    if (new Set(component.protectedProperties).size !== component.protectedProperties.length) {
      ctx.addIssue({ code: "custom", path: ["components", index, "protectedProperties"], message: "DUPLICATE_PROTECTED_PROPERTY" });
    }
    ids.add(component.id);
    orders.add(component.order);
  }
  if (new Set(model.allowedOperations).size !== model.allowedOperations.length) {
    ctx.addIssue({ code: "custom", path: ["allowedOperations"], message: "DUPLICATE_OPERATION" });
  }
});

export type UniversalLayoutModel = z.infer<typeof universalLayoutModelSchema>;
export type UniversalLayoutComponent = UniversalLayoutModel["components"][number];
export type UniversalLayoutPlan = z.infer<typeof universalLayoutPlanSchema>;

const planOperationSchema = z.object({
  type: z.literal("setColumns"),
  targetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  columns: z.number().int().min(1).max(6),
}).strict();

export const universalLayoutPlanSchema = z.object({
  schemaVersion: z.literal(UNIVERSAL_LAYOUT_SCHEMA_VERSION),
  contractVersion: z.literal(UNIVERSAL_LAYOUT_CONTRACT_VERSION),
  hostId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  screenId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
  structureVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{64}$/),
  viewportClass: z.enum(["compact", "regular", "wide"]),
  operations: z.array(planOperationSchema).min(1).max(20),
}).strict().superRefine((plan, ctx) => {
  const targets = new Set<string>();
  for (const [index, operation] of plan.operations.entries()) {
    if (targets.has(operation.targetId)) {
      ctx.addIssue({ code: "custom", path: ["operations", index, "targetId"], message: "CONFLICTING_OPERATION_TARGET" });
    }
    targets.add(operation.targetId);
  }
});

export type UniversalViewportClass = UniversalLayoutModel["viewportClass"];

export type UniversalComponentPolicy = {
  id: string;
  kind: string;
  role: string;
  order: number;
  itemCountRange: readonly [number, number];
  operations: readonly ["setColumns"];
  allowedColumnsByViewport: Readonly<Record<UniversalViewportClass, readonly number[]>>;
  singleColumnForLargeText: boolean;
  singleColumnForLargeButtons: boolean;
  singleColumnForHighContrast: boolean;
  singleColumnForBottomViewport: boolean;
  minimumTouchTargetPx: number;
  protectedProperties: readonly string[];
};

export type UniversalLayoutPolicy = {
  hostId: string;
  screenId: string;
  structureVersion: string;
  components: readonly UniversalComponentPolicy[];
};

export type UniversalLayoutErrorCode =
  | "UNSUPPORTED_HOST_SCREEN"
  | "POLICY_COMPONENT_INVALID"
  | "STRUCTURE_HASH_MISMATCH"
  | "CONSTRAINT_HASH_MISMATCH"
  | "COMPONENT_POLICY_MISMATCH"
  | "ACCESSIBILITY_CONSTRAINT_MISMATCH"
  | "PLAN_MODEL_MISMATCH"
  | "UNSUPPORTED_PLAN_OPERATION"
  | "DISALLOWED_COLUMN_COUNT";

export class UniversalLayoutValidationError extends Error {
  constructor(readonly code: UniversalLayoutErrorCode) {
    super(code);
    this.name = "UniversalLayoutValidationError";
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("CANONICAL_NUMBER_MUST_BE_SAFE_INTEGER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalizedEntries = Object.entries(record).map(([key, entry]) => [key.normalize("NFC"), entry] as const);
    const normalizedKeys = normalizedEntries.map(([key]) => key);
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      throw new TypeError("CANONICAL_DUPLICATE_NORMALIZED_KEY");
    }
    return Object.fromEntries(
      normalizedEntries
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError("CANONICAL_UNSUPPORTED_VALUE");
}

export function canonicalUniversalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function universalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalUniversalJson(value), "utf8").digest("hex");
}

export function computeUniversalStructureHash(
  model: Pick<UniversalLayoutModel, "hostId" | "screenId" | "structureVersion" | "components">,
): string {
  const components = [...model.components]
    .sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map(({ id, kind, role, order, itemCount, itemOrderHash }) => ({
      id, kind, role, order, itemCount, itemOrderHash,
    }));
  return universalSha256({
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    components,
  });
}

export function computeUniversalConstraintHash(
  model: Pick<UniversalLayoutModel, "contractVersion" | "viewportClass" | "accessibility" | "components" | "allowedOperations">,
): string {
  const components = [...model.components]
    .sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map(({ id, operations, allowedColumns, minimumTouchTargetPx, protectedProperties }) => ({
      id, operations, allowedColumns, minimumTouchTargetPx, protectedProperties,
    }));
  return universalSha256({
    contractVersion: model.contractVersion,
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    allowedOperations: model.allowedOperations,
    components,
  });
}

function allowedColumnsFor(
  component: UniversalComponentPolicy,
  viewportClass: UniversalViewportClass,
  accessibility: UniversalLayoutModel["accessibility"],
): number[] {
  const base = [...component.allowedColumnsByViewport[viewportClass]];
  const forceSingle =
    (component.singleColumnForLargeText && accessibility.textScale !== "standard") ||
    (component.singleColumnForLargeButtons && accessibility.buttonScale === "large") ||
    (component.singleColumnForHighContrast && accessibility.contrast === "high") ||
    (component.singleColumnForBottomViewport && accessibility.viewportMode !== null);
  return forceSingle ? base.filter((columns) => columns === 1) : base;
}

function componentMatchesPolicy(
  component: UniversalLayoutComponent,
  policy: UniversalComponentPolicy,
  viewportClass: UniversalViewportClass,
  accessibility: UniversalLayoutModel["accessibility"],
): boolean {
  const allowedColumns = allowedColumnsFor(policy, viewportClass, accessibility);
  return component.id === policy.id &&
    component.kind === policy.kind &&
    component.role === policy.role &&
    component.order === policy.order &&
    component.itemCount >= policy.itemCountRange[0] &&
    component.itemCount <= policy.itemCountRange[1] &&
    /^[a-f0-9]{64}$/.test(component.itemOrderHash) &&
    JSON.stringify(component.operations) === JSON.stringify(policy.operations) &&
    JSON.stringify(component.allowedColumns) === JSON.stringify(allowedColumns) &&
    component.minimumTouchTargetPx === policy.minimumTouchTargetPx &&
    component.minimumTouchTargetPx >= 44 &&
    JSON.stringify(component.protectedProperties) === JSON.stringify(policy.protectedProperties);
}

export function createUniversalLayoutModel(
  policy: UniversalLayoutPolicy,
  options: {
    viewportClass: UniversalViewportClass;
    accessibility: UniversalLayoutModel["accessibility"];
    componentState: readonly {
      id: string;
      itemCount: number;
      itemOrderHash: string;
    }[];
  },
): UniversalLayoutModel {
  if (policy.components.length === 0) {
    throw new UniversalLayoutValidationError("POLICY_COMPONENT_INVALID");
  }
  if (
    options.componentState.length !== policy.components.length ||
    new Set(options.componentState.map((component) => component.id)).size !== options.componentState.length
  ) {
    throw new UniversalLayoutValidationError("POLICY_COMPONENT_INVALID");
  }
  const stateById = new Map(options.componentState.map((component) => [component.id, component]));
  const components = policy.components.map((component) => {
    const allowedColumns = allowedColumnsFor(component, options.viewportClass, options.accessibility);
    const state = stateById.get(component.id);
    if (
      allowedColumns.length === 0 ||
      component.minimumTouchTargetPx < 44 ||
      component.minimumTouchTargetPx > 96 ||
      !state ||
      !Number.isSafeInteger(state.itemCount) ||
      state.itemCount < component.itemCountRange[0] ||
      state.itemCount > component.itemCountRange[1] ||
      !/^[a-f0-9]{64}$/.test(state.itemOrderHash)
    ) {
      throw new UniversalLayoutValidationError("POLICY_COMPONENT_INVALID");
    }
    return {
      id: component.id,
      kind: component.kind,
      role: component.role,
      order: component.order,
      itemCount: state.itemCount,
      itemOrderHash: state.itemOrderHash,
      operations: [...component.operations],
      allowedColumns,
      minimumTouchTargetPx: component.minimumTouchTargetPx,
      protectedProperties: [...component.protectedProperties],
    };
  });
  const partial = {
    schemaVersion: UNIVERSAL_LAYOUT_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_CONTRACT_VERSION,
    hostId: policy.hostId,
    screenId: policy.screenId,
    structureVersion: policy.structureVersion,
    structureHash: "",
    constraintHash: "",
    viewportClass: options.viewportClass,
    accessibility: options.accessibility,
    components,
    allowedOperations: ["setColumns"] as ("setColumns")[],
  };
  const modelWithoutHashes = {
    ...partial,
    structureHash: computeUniversalStructureHash(partial),
  };
  return universalLayoutModelSchema.parse({
    ...modelWithoutHashes,
    constraintHash: computeUniversalConstraintHash(modelWithoutHashes),
  });
}

export function validateUniversalLayoutModel(
  value: unknown,
  policies: readonly UniversalLayoutPolicy[],
): UniversalLayoutModel {
  const model = universalLayoutModelSchema.parse(value);
  const policy = policies.find((candidate) =>
    candidate.hostId === model.hostId && candidate.screenId === model.screenId,
  );
  if (!policy) throw new UniversalLayoutValidationError("UNSUPPORTED_HOST_SCREEN");
  if (
    model.structureVersion !== policy.structureVersion ||
    model.components.length !== policy.components.length ||
    model.components.some((component, index) =>
      !componentMatchesPolicy(component, policy.components[index], model.viewportClass, model.accessibility),
    )
  ) {
    throw new UniversalLayoutValidationError("COMPONENT_POLICY_MISMATCH");
  }
  if (model.structureHash !== computeUniversalStructureHash(model)) {
    throw new UniversalLayoutValidationError("STRUCTURE_HASH_MISMATCH");
  }
  if (model.constraintHash !== computeUniversalConstraintHash(model)) {
    throw new UniversalLayoutValidationError("CONSTRAINT_HASH_MISMATCH");
  }
  return model;
}

export function validateUniversalLayoutPlan(
  value: unknown,
  model: UniversalLayoutModel,
  policies: readonly UniversalLayoutPolicy[],
): UniversalLayoutPlan {
  const validatedModel = validateUniversalLayoutModel(model, policies);
  const plan = universalLayoutPlanSchema.parse(value);
  if (
    plan.schemaVersion !== validatedModel.schemaVersion ||
    plan.contractVersion !== validatedModel.contractVersion ||
    plan.hostId !== validatedModel.hostId ||
    plan.screenId !== validatedModel.screenId ||
    plan.structureVersion !== validatedModel.structureVersion ||
    plan.structureHash !== validatedModel.structureHash ||
    plan.constraintHash !== validatedModel.constraintHash ||
    plan.viewportClass !== validatedModel.viewportClass
  ) {
    throw new UniversalLayoutValidationError("PLAN_MODEL_MISMATCH");
  }
  for (const operation of plan.operations) {
    const component = validatedModel.components.find((candidate) => candidate.id === operation.targetId);
    if (!component || !component.operations.includes(operation.type)) {
      throw new UniversalLayoutValidationError("UNSUPPORTED_PLAN_OPERATION");
    }
    if (!component.allowedColumns.includes(operation.columns)) {
      throw new UniversalLayoutValidationError("DISALLOWED_COLUMN_COUNT");
    }
  }
  return plan;
}
