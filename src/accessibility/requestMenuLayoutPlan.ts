import {
  validateMenuLayoutPlan,
  type MenuScreenModel,
  type ValidatedMenuLayout,
} from "./menuLayoutPlan.ts";

export type MenuLayoutPlanRequestResult = {
  plan: ValidatedMenuLayout | null;
  status: number;
  requestId: string | null;
  stage: "http_error" | "json_parse_error" | "plan_validation_error" | "validated";
};

export async function requestMenuLayoutPlan(
  model: MenuScreenModel,
  fetchImpl: typeof fetch = fetch,
): Promise<MenuLayoutPlanRequestResult> {
  const response = await fetchImpl("/api/ai-layout/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  const requestId = response.headers.get("x-request-id");
  if (!response.ok) return { plan: null, status: response.status, requestId, stage: "http_error" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { plan: null, status: response.status, requestId, stage: "json_parse_error" };
  }
  const plan = validateMenuLayoutPlan(body, model);
  return plan
    ? { plan, status: response.status, requestId, stage: "validated" }
    : { plan: null, status: response.status, requestId, stage: "plan_validation_error" };
}
