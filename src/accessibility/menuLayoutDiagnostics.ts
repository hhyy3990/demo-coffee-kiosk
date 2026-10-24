export type MenuLayoutDiagnosticEvent = {
  phase: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type StoredMenuLayoutDiagnostic = {
  recordedAt: string;
  sessionId: string;
  pageRunId: string;
  phase: string;
  [key: string]: string | number | boolean | null;
};

export const MENU_LAYOUT_DIAGNOSTICS_KEY = "demo-coffee:menu-layout-diagnostics:v1";
export const MENU_LAYOUT_DIAGNOSTICS_LIMIT = 50;

const allowedFields = new Set([
  "phase", "screenId", "source", "status", "stageIsMenu", "featureFlagEnabled",
  "centralQrProfileActive", "mockOnly", "valid", "defaultColumns",
  "allowedColumns", "textScale", "buttonScale", "viewportWidth",
  "viewportClass", "columns", "explicitColumns", "cardLayout", "localRequestId",
  "reason", "previousViewportClass", "nextViewportClass", "previousColumns",
  "viewportChanged", "constraintsChanged", "structureChanged", "planState",
  "aiColumns", "aiCardFlow", "computedColumnCount",
  "computedGridTemplateColumns", "cardLayoutApplied", "imageInfoGapPx",
  "universalColumns",
  "planInvalidated", "optionGroupCount",
]);

let pageRunId: string | null = null;
let fallbackSessionId: string | null = null;

function createId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function getSessionId(): string {
  if (fallbackSessionId) return fallbackSessionId;
  const target = storage();
  if (target) {
    try {
      const existing = target.getItem(`${MENU_LAYOUT_DIAGNOSTICS_KEY}:session`);
      if (existing && existing.length <= 80) {
        fallbackSessionId = existing;
        return existing;
      }
      const next = createId();
      target.setItem(`${MENU_LAYOUT_DIAGNOSTICS_KEY}:session`, next);
      fallbackSessionId = next;
      return next;
    } catch {
      // Diagnostics continue in memory when sessionStorage is unavailable.
    }
  }
  fallbackSessionId = createId();
  return fallbackSessionId;
}

export function sanitizeMenuLayoutDiagnostic(
  event: MenuLayoutDiagnosticEvent,
  context: { recordedAt?: string; sessionId?: string; pageRunId?: string } = {},
): StoredMenuLayoutDiagnostic {
  const safe: Record<string, string | number | boolean | null> = {
    recordedAt: context.recordedAt ?? new Date().toISOString(),
    sessionId: context.sessionId ?? getSessionId(),
    pageRunId: context.pageRunId ?? getMenuLayoutPageRunId(),
    phase: typeof event.phase === "string" ? event.phase.slice(0, 80) : "unknown",
    screenId: typeof event.screenId === "string" ? event.screenId.slice(0, 80) : "cafe.menu",
  };
  for (const field of allowedFields) {
    if (field === "phase" || !(field in event)) continue;
    const value = event[field];
    if (typeof value === "string") safe[field] = value.slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) safe[field] = value;
    else if (typeof value === "boolean" || value === null) safe[field] = value;
  }
  return safe as StoredMenuLayoutDiagnostic;
}

export function getMenuLayoutPageRunId(): string {
  if (pageRunId) return pageRunId;
  try {
    const target = typeof window === "undefined" ? null : window as Window & { __demoCoffeePageRunId?: string };
    if (target?.__demoCoffeePageRunId) return pageRunId = target.__demoCoffeePageRunId;
    pageRunId = createId();
    if (target) target.__demoCoffeePageRunId = pageRunId;
    return pageRunId;
  } catch {
    pageRunId = createId();
    return pageRunId;
  }
}

export function loadMenuLayoutDiagnosticHistory(): StoredMenuLayoutDiagnostic[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed: unknown = JSON.parse(target.getItem(MENU_LAYOUT_DIAGNOSTICS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MENU_LAYOUT_DIAGNOSTICS_LIMIT).filter((item) =>
      item && typeof item === "object" && typeof item.phase === "string" &&
      typeof item.recordedAt === "string" && typeof item.sessionId === "string" &&
      typeof item.pageRunId === "string",
    ).map((item) => sanitizeMenuLayoutDiagnostic(item as MenuLayoutDiagnosticEvent, {
      recordedAt: item.recordedAt,
      sessionId: item.sessionId,
      pageRunId: item.pageRunId,
    }));
  } catch {
    return [];
  }
}

export function persistMenuLayoutDiagnostic(
  event: MenuLayoutDiagnosticEvent,
): StoredMenuLayoutDiagnostic {
  const record = sanitizeMenuLayoutDiagnostic(event);
  const target = storage();
  if (target) {
    try {
      const history = loadMenuLayoutDiagnosticHistory();
      target.setItem(
        MENU_LAYOUT_DIAGNOSTICS_KEY,
        JSON.stringify([...history, record].slice(-MENU_LAYOUT_DIAGNOSTICS_LIMIT)),
      );
    } catch {
      // Storage quota/security failures must not interrupt kiosk behavior.
    }
  }
  return record;
}

export function clearMenuLayoutDiagnosticHistory(): void {
  const target = storage();
  if (target) {
    try {
      target.removeItem(MENU_LAYOUT_DIAGNOSTICS_KEY);
    } catch {
      // The in-memory view is still cleared by the panel.
    }
  }
}
