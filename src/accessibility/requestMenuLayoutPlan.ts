import {
  validateMenuLayoutPlan,
  type MenuScreenModel,
  type ValidatedMenuLayout,
} from "./menuLayoutPlan.ts";

export async function requestMenuLayoutPlan(
  model: MenuScreenModel,
  fetchImpl: typeof fetch = fetch,
): Promise<ValidatedMenuLayout | null> {
  const response = await fetchImpl("/api/ai-layout/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) return null;
  return validateMenuLayoutPlan(await response.json(), model);
}
