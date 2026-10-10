import type {
  AccessibilityAdapter,
  KioskAction,
  KioskTextTarget,
} from "./adapter.ts";

export type AccessibilityIssueType =
  | "text-clipped"
  | "horizontal-overflow"
  | "action-offscreen"
  | "bottom-control-obscures-action"
  | "small-touch-target"
  | "action-overlap";

export interface AccessibilityDiagnostic {
  screenId: string;
  semanticId: string;
  relatedSemanticId?: string;
  issueType: AccessibilityIssueType;
  measurements: Readonly<Record<string, number | boolean>>;
}

export interface LayoutDiagnosticOptions {
  minimumTouchTarget?: number;
}

function safeSemanticId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value) ? value : "unmapped";
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function textIsClipped(target: KioskTextTarget): boolean {
  const element = target.element;
  if (!element.isConnected || !isVisible(element)) return false;

  const ownStyle = window.getComputedStyle(element);
  const ownHasClippingOverflow =
    ownStyle.overflowX === "hidden" || ownStyle.overflowX === "clip" ||
    ownStyle.overflowY === "hidden" || ownStyle.overflowY === "clip";
  const ownScrollClipped =
    ownHasClippingOverflow &&
    (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
  const lineClamp = ownStyle.getPropertyValue("-webkit-line-clamp");
  if (ownScrollClipped || (lineClamp && lineClamp !== "none" && lineClamp !== "0")) return true;

  const range = document.createRange();
  range.selectNodeContents(element);
  const textRect = range.getBoundingClientRect();
  if (textRect.width === 0 && textRect.height === 0) return false;

  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const rect = ancestor.getBoundingClientRect();
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (
      (clipsX && (textRect.left < rect.left - 1 || textRect.right > rect.right + 1)) ||
      (clipsY && (textRect.top < rect.top - 1 || textRect.bottom > rect.bottom + 1))
    ) {
      return true;
    }
    if (ancestor === element.ownerDocument.documentElement) break;
  }

  return false;
}

function horizontalOverflow(root: HTMLElement): boolean {
  const rect = root.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  return root.scrollWidth > root.clientWidth + 1 || rect.left < -1 || rect.right > viewportWidth + 1;
}

function actionIsScrollable(action: KioskAction, scrollArea: HTMLElement | null | undefined): boolean {
  return Boolean(scrollArea && (scrollArea === action.element || scrollArea.contains(action.element)));
}

export function inspectKioskLayout(
  root: HTMLElement,
  adapter: AccessibilityAdapter,
  options: LayoutDiagnosticOptions = {},
): AccessibilityDiagnostic[] {
  const screenId = safeSemanticId(adapter.getSnapshot().screenId);
  const issues: AccessibilityDiagnostic[] = [];
  const minimumTouchTarget = options.minimumTouchTarget ?? 44;
  const regions = adapter.getLayoutRegions();

  if (horizontalOverflow(root)) {
    issues.push({
      screenId,
      semanticId: "kiosk.root",
      issueType: "horizontal-overflow",
      measurements: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        viewportWidth: document.documentElement.clientWidth || window.innerWidth,
      },
    });
  }

  for (const target of adapter.getTextTargets()) {
    if (!root.contains(target.element) || !textIsClipped(target)) continue;
    issues.push({
      screenId,
      semanticId: safeSemanticId(target.id),
      issueType: "text-clipped",
      measurements: {
        clientWidth: target.element.clientWidth,
        scrollWidth: target.element.scrollWidth,
        clientHeight: target.element.clientHeight,
        scrollHeight: target.element.scrollHeight,
      },
    });
  }

  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const actions = adapter.getActions().filter((action) => root.contains(action.element) && isVisible(action.element));
  const bottomControls = (regions.bottomControls ?? []).filter((element) =>
    root.contains(element) && isVisible(element),
  );

  for (const action of actions) {
    const rect = action.element.getBoundingClientRect();
    if (rect.width < minimumTouchTarget || rect.height < minimumTouchTarget) {
      issues.push({
        screenId,
        semanticId: safeSemanticId(action.id),
        issueType: "small-touch-target",
        measurements: {
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          minimum: minimumTouchTarget,
          enabled: action.enabled,
        },
      });
    }

    const outsideHorizontalViewport = rect.left < 0 || rect.right > viewportWidth;
    const outsideVerticalViewport =
      (rect.top < 0 || rect.bottom > viewportHeight) &&
      !actionIsScrollable(action, regions.scrollArea);
    if (outsideHorizontalViewport || outsideVerticalViewport) {
      issues.push({
        screenId,
          semanticId: safeSemanticId(action.id),
        issueType: "action-offscreen",
        measurements: {
          left: Math.round(rect.left * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          viewportWidth,
          viewportHeight,
        },
      });
    }

    if (!action.enabled) continue;
    for (const bottomControl of bottomControls) {
      if (bottomControl.contains(action.element)) continue;
      const bottomRect = bottomControl.getBoundingClientRect();
      if (!overlaps(rect, bottomRect)) continue;
      issues.push({
        screenId,
        semanticId: safeSemanticId(action.id),
        issueType: "bottom-control-obscures-action",
        measurements: {
          actionTop: Math.round(rect.top * 100) / 100,
          actionBottom: Math.round(rect.bottom * 100) / 100,
          controlTop: Math.round(bottomRect.top * 100) / 100,
          controlBottom: Math.round(bottomRect.bottom * 100) / 100,
        },
      });
      break;
    }
  }

  for (let index = 0; index < actions.length; index += 1) {
    const first = actions[index];
    const firstRect = first.element.getBoundingClientRect();
    for (let next = index + 1; next < actions.length; next += 1) {
      const second = actions[next];
      const secondRect = second.element.getBoundingClientRect();
      if (!overlaps(firstRect, secondRect)) continue;
      issues.push({
        screenId,
        semanticId: safeSemanticId(first.id),
        relatedSemanticId: safeSemanticId(second.id),
        issueType: "action-overlap",
        measurements: {
          overlapWidth: Math.max(0, Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left)),
          overlapHeight: Math.max(0, Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top)),
        },
      });
    }
  }

  return issues;
}
