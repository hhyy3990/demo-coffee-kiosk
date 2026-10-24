import type { MenuScreenModel, ValidatedMenuLayout } from "./menuLayoutPlan.ts";

export type AutoMenuLayoutResult = {
  plan: ValidatedMenuLayout | null;
  cached: boolean;
  stale: boolean;
};

function modelKey(model: MenuScreenModel): string {
  return [
    model.screenId,
    model.structureHash,
    model.constraintHash,
    model.viewportClass,
  ].join(":");
}

/**
 * Deduplicates automatic plan requests, keeps validated plans for menu re-entry,
 * and prevents responses from an invalidated profile/viewport being applied.
 */
export function createAutoMenuLayoutCoordinator() {
  let generation = 0;
  const cache = new Map<string, ValidatedMenuLayout>();
  const inFlight = new Map<string, Promise<AutoMenuLayoutResult>>();

  return {
    invalidate(): void {
      generation += 1;
      cache.clear();
    },

    async run(
      model: MenuScreenModel,
      request: (model: MenuScreenModel) => Promise<ValidatedMenuLayout | null>,
    ): Promise<AutoMenuLayoutResult> {
      const key = modelKey(model);
      const cachedPlan = cache.get(key);
      if (cachedPlan) return { plan: cachedPlan, cached: true, stale: false };

      const existing = inFlight.get(key);
      if (existing) return existing;

      const requestGeneration = generation;
      const pending = (async (): Promise<AutoMenuLayoutResult> => {
        let plan: ValidatedMenuLayout | null = null;
        try {
          plan = await request(model);
        } catch {
          plan = null;
        }
        if (requestGeneration !== generation) {
          return { plan: null, cached: false, stale: true };
        }
        if (plan) cache.set(key, plan);
        return { plan, cached: false, stale: false };
      })();
      inFlight.set(key, pending);
      try {
        return await pending;
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    },
  };
}
