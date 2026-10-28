import { z } from "zod";
import {
  universalLayoutV2ModelSchema,
  universalLayoutV2PlanSchema,
} from "./universal-layout-contract-v2.ts";

export {
  UNIVERSAL_LAYOUT_V2_CAPABILITIES,
  UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
  UniversalLayoutV2ValidationError,
  computeUniversalLayoutV2ConstraintHash,
  computeUniversalLayoutV2StructureHash,
  createUniversalLayoutV2Model,
  parseUniversalLayoutV2Plan,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2OptionSelection,
  validateUniversalLayoutV2OptionSelections,
  validateUniversalLayoutV2Plan,
  universalLayoutV2ModelSchema,
  universalLayoutV2PlanSchema,
} from "./universal-layout-contract-v2.ts";
export {
  canonicalUniversalJson,
  universalSha256,
} from "./universal-layout-contract.ts";
export type {
  UniversalLayoutV2Accessibility,
  UniversalLayoutV2Capability,
  UniversalLayoutV2Component,
  UniversalLayoutV2Model,
  UniversalLayoutV2Operation,
  UniversalLayoutV2OptionDefinition,
  UniversalLayoutV2OptionGroupPolicy,
  UniversalLayoutV2OptionSelection,
  UniversalLayoutV2Plan,
  UniversalLayoutV2Policy,
  UniversalLayoutV2Viewport,
} from "./universal-layout-contract-v2.ts";

/**
 * Generated directly from the central Zod schemas. JSON Schema cannot encode
 * policy reconstruction, hash equality, or cross-field uniqueness checks;
 * run the exported validators after schema parsing.
 */
export const UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA = z.toJSONSchema(
  universalLayoutV2ModelSchema,
  { unrepresentable: "any" },
);
export const UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA = z.toJSONSchema(
  universalLayoutV2PlanSchema,
  { unrepresentable: "any" },
);
