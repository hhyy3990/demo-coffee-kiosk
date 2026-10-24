import express from "express";
import { z } from "zod";
import {
  createUniversalLayoutModel,
  universalSha256,
  validateUniversalLayoutModel,
  validateUniversalLayoutPlan,
} from "./universal-layout-contract.ts";
import { demoCoffeeMenuPolicy } from "./demo-coffee-policy.ts";

const AccessibilityInput = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  viewportMode: z.union([
    z.null(),
    z.object({ mode: z.literal("bottom"), heightPercent: z.union([
      z.literal(60), z.literal(70), z.literal(80),
    ]) }).strict(),
  ]),
}).strict();

const MockRequest = z.object({
  viewportClass: z.enum(["compact", "regular"]),
  accessibility: AccessibilityInput,
  orderedItemIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).max(100),
  columns: z.union([z.literal(1), z.literal(2)]),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderedItemIds).size !== value.orderedItemIds.length) {
    context.addIssue({ code: "custom", path: ["orderedItemIds"], message: "DUPLICATE_ITEM_ID" });
  }
});

const policies = [demoCoffeeMenuPolicy];

export function registerUniversalLayoutMockRoute(app, { env = process.env } = {}) {
  if (env.NODE_ENV !== "development") return;

  app.post(
    "/api/dev/universal-layout/mock-plan",
    express.json({ limit: "8kb", strict: true }),
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (env.NODE_ENV !== "development") return res.sendStatus(404);
      const parsed = MockRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "INVALID_MOCK_INPUT" });

      const input = parsed.data;
      try {
        const model = createUniversalLayoutModel(demoCoffeeMenuPolicy, {
          viewportClass: input.viewportClass,
          accessibility: input.accessibility,
          componentState: [{
            id: "menu.product-list",
            itemCount: input.orderedItemIds.length,
            itemOrderHash: universalSha256({ orderedItemIds: input.orderedItemIds }),
          }],
        });
        const validatedModel = validateUniversalLayoutModel(model, policies);
        const plan = {
          schemaVersion: validatedModel.schemaVersion,
          contractVersion: validatedModel.contractVersion,
          hostId: validatedModel.hostId,
          screenId: validatedModel.screenId,
          structureVersion: validatedModel.structureVersion,
          structureHash: validatedModel.structureHash,
          constraintHash: validatedModel.constraintHash,
          viewportClass: validatedModel.viewportClass,
          operations: [{
            type: "setColumns",
            targetId: "menu.product-list",
            columns: input.columns,
          }],
        };
        const validatedPlan = validateUniversalLayoutPlan(plan, validatedModel, policies);
        return res.status(200).json({ model: validatedModel, plan: validatedPlan });
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "MOCK_VALIDATION_FAILED";
        const status = code === "DISALLOWED_COLUMN_COUNT" ? 422 : 400;
        return res.status(status).json({ error: code });
      }
    },
  );
}
