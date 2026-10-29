import express from "express";
import { z } from "zod";
import {
  createUniversalLayoutV2Model,
  universalSha256,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
} from "./universal-v2-contract-export.ts";
import { demoCoffeeUniversalV2PolicyForViewport } from "./demo-coffee-dev-policy.ts";
const AccessibilityInput = z.object({
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

const MockRequest = z.object({
  viewportClass: z.enum(["compact", "regular", "wide"]),
  accessibility: AccessibilityInput,
  orderedItemIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderedItemIds).size !== value.orderedItemIds.length) {
    context.addIssue({ code: "custom", path: ["orderedItemIds"], message: "DUPLICATE_ITEM_ID" });
  }
});

export function registerUniversalLayoutV2MockRoute(app, { env = process.env } = {}) {
  if (env.NODE_ENV !== "development") return;

  app.post(
    "/api/dev/universal-layout/v2/mock-plan",
    express.json({ limit: "8kb", strict: true }),
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (env.NODE_ENV !== "development") return res.sendStatus(404);
      const parsed = MockRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "INVALID_MOCK_INPUT" });

      const input = parsed.data;
      try {
        const policy = demoCoffeeUniversalV2PolicyForViewport(input.viewportClass);
        const policies = [policy];
        const model = createUniversalLayoutV2Model(policy, {
          viewportClass: input.viewportClass,
          accessibility: input.accessibility,
          layoutCapabilities: [],
          componentState: [{
            id: "menu.product-list",
            itemCount: input.orderedItemIds.length,
            itemOrderHash: universalSha256({ orderedItemIds: input.orderedItemIds }),
          }],
        });
        const validatedModel = validateUniversalLayoutV2Model(model, policies);
        const arrangement = validatedModel.components
          .find((component) => component.id === "menu.product-list")
          ?.optionGroups?.find((group) => group.id === "arrangement");
        const optionId = arrangement?.optionIds.includes("single-column-list")
          ? "single-column-list"
          : arrangement?.optionIds.includes("compact-grid") ? "compact-grid" : null;
        if (!optionId) {
          return res.status(422).json({ error: "UNSUPPORTED_PLAN_OPERATION" });
        }
        const plan = validateUniversalLayoutV2Plan({
          schemaVersion: validatedModel.schemaVersion,
          contractVersion: validatedModel.contractVersion,
          hostId: validatedModel.hostId,
          screenId: validatedModel.screenId,
          structureVersion: validatedModel.structureVersion,
          structureHash: validatedModel.structureHash,
          constraintHash: validatedModel.constraintHash,
          viewportClass: validatedModel.viewportClass,
          operations: [{
            type: "selectLayoutOption",
            targetId: "menu.product-list",
            groupId: "arrangement",
            optionId,
          }],
        }, validatedModel, policies);
        return res.status(200).json({ model: validatedModel, plan });
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "MOCK_VALIDATION_FAILED";
        return res.status(
          code === "UNSUPPORTED_OPTION_SELECTION" || code === "UNSUPPORTED_PLAN_OPERATION" ? 422 : 400,
        )
          .json({ error: code });
      }
    },
  );
}
