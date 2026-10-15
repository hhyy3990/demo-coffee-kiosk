import type {
  AccessibilityAdapter,
  KioskAction,
  KioskTextTarget,
} from "./adapter.ts";
import { analyzeAdditionalMenuOverflow } from "./menu-overflow.ts";
import { getQrEntryDockButtons } from "./qr-entry-dock.ts";

export type AccessibilityIssueType =
  | "text-clipped"
  | "text-obscured"
  | "horizontal-overflow"
  | "action-offscreen"
  | "bottom-control-obscures-action"
  | "last-scroll-action-obscured"
  | "small-touch-target"
  | "action-overlap"
  | "menu-overflow-unreachable"
  | "guide-suppressed";

export interface AccessibilityDiagnostic {
  screenId: string;
  semanticId: string;
  relatedSemanticId?: string;
  issueType: AccessibilityIssueType;
  measurements: Readonly<Record<string, number | boolean>>;
  severity?: "warning" | "error";
  elementTag?: string;
  elementRect?: Readonly<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>;
  viewport?: Readonly<{ width: number; height: number }>;
  profile?: Readonly<{ textSize: string; buttonSize: string; contrast: string; viewportMode: number | null }>;
  recommendation?: string;
  autoCorrection?: "applied" | "failed" | "not-attempted";
  reason?: "target-overflow" | "ancestor-overflow" | "line-clamp" | "fixed-button" | "qr-button";
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

function textClipReason(target: KioskTextTarget): AccessibilityDiagnostic["reason"] | null {
  const element = target.element;
  if (!element.isConnected || !isVisible(element)) return null;

  const ownStyle = window.getComputedStyle(element);
  const ownHasClippingOverflow =
    ownStyle.overflowX === "hidden" || ownStyle.overflowX === "clip" ||
    ownStyle.overflowY === "hidden" || ownStyle.overflowY === "clip";
  const ownScrollClipped =
    ownHasClippingOverflow &&
    (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
  const lineClamp = ownStyle.getPropertyValue("-webkit-line-clamp");
  if (ownScrollClipped) return "target-overflow";
  if (lineClamp && lineClamp !== "none" && lineClamp !== "0") return "line-clamp";

  const range = document.createRange();
  range.selectNodeContents(element);
  const textRect = range.getBoundingClientRect();
  if (textRect.width === 0 && textRect.height === 0) return null;

  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const rect = ancestor.getBoundingClientRect();
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (
      (clipsX && (textRect.left < rect.left - 1 || textRect.right > rect.right + 1)) ||
      (clipsY && (textRect.top < rect.top - 1 || textRect.bottom > rect.bottom + 1))
    ) {
      return "ancestor-overflow";
    }
    if (ancestor === element.ownerDocument.documentElement) break;
  }

  return null;
}

function intersects(a: DOMRect, b: DOMRect): { width: number; height: number } | null {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width > 0 && height > 0 ? { width, height } : null;
}

function fixedButtons(root: HTMLElement, adapter: AccessibilityAdapter, bottomControls: HTMLElement[]) {
  const results = new Map<HTMLElement, { id: string; reason: "fixed-button" | "qr-button" }>();
  const registered = adapter.getActions().filter((action) => root.contains(action.element) && isVisible(action.element));
  const fixedBottomControls = bottomControls.filter((control) => {
    const position = window.getComputedStyle(control).position;
    return position === "fixed" || position === "sticky";
  });
  for (const action of registered) {
    const style = window.getComputedStyle(action.element);
    if (fixedBottomControls.some((control) => control === action.element || control.contains(action.element)) ||
      style.position === "fixed" || style.position === "sticky") {
      results.set(action.element, { id: safeSemanticId(action.id), reason: "fixed-button" });
    }
  }
  for (const control of fixedBottomControls) {
    const candidates = [
      ...(typeof control.matches === "function" && control.matches("button, a, input, [role='button']") ? [control] : []),
      ...(typeof control.querySelectorAll === "function"
        ? Array.from(control.querySelectorAll<HTMLElement>("button, a, input, [role='button']"))
        : []),
    ];
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const action = registered.find((item) => item.element === element);
      results.set(element, { id: action ? safeSemanticId(action.id) : "unmapped.fixed-button", reason: "fixed-button" });
    }
  }
  for (const element of getQrEntryDockButtons(root)) {
    if (isVisible(element)) results.set(element, { id: "qr-entry.open", reason: "qr-button" });
  }
  return [...results.entries()].map(([element, data]) => ({ element, ...data }));
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
  const bottomControls = (regions.bottomControls ?? []).filter((element) =>
    isVisible(element),
  );

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

  const textTargets = new Map([
    ...adapter.getTextTargets(),
    ...(adapter.getFontCorrectionTargets?.() ?? []),
  ].map((target) => [target.id, target]));
  const visibleTextTargets = [...textTargets.values()].filter((target) =>
    root.contains(target.element) && isVisible(target.element),
  );
  for (const target of visibleTextTargets) {
    const reason = textClipReason(target);
    if (!reason) continue;
    issues.push({
      screenId,
      semanticId: safeSemanticId(target.id),
      issueType: "text-clipped",
      reason,
      measurements: {
        clientWidth: target.element.clientWidth,
        scrollWidth: target.element.scrollWidth,
        clientHeight: target.element.clientHeight,
        scrollHeight: target.element.scrollHeight,
      },
    });
  }
  const actionableObstacles = fixedButtons(root, adapter, bottomControls);
  for (const target of visibleTextTargets) {
    const textRect = target.element.getBoundingClientRect();
    for (const obstacle of actionableObstacles) {
      if (obstacle.element === target.element ||
        obstacle.element.contains(target.element) || target.element.contains(obstacle.element)) continue;
      const overlap = intersects(textRect, obstacle.element.getBoundingClientRect());
      if (!overlap) continue;
      issues.push({
        screenId,
        semanticId: safeSemanticId(target.id),
        relatedSemanticId: obstacle.id,
        issueType: "text-obscured",
        reason: obstacle.reason,
        measurements: {
          overlapWidth: Math.round(overlap.width * 100) / 100,
          overlapHeight: Math.round(overlap.height * 100) / 100,
        },
      });
    }
  }

  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const actions = adapter.getActions().filter((action) => root.contains(action.element) && isVisible(action.element));
  const scrollArea = regions.scrollArea;
  if (scrollArea && root.contains(scrollArea)) {
    const scrollActions = actions.filter((action) => scrollArea.contains(action.element));
    const lastAction = scrollActions.at(-1);
    const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
    if (lastAction && maxScroll > 1) {
      const areaRect = scrollArea.getBoundingClientRect();
      const predictedRect = lastAction.element.getBoundingClientRect();
      const predictedBottom = predictedRect.bottom - Math.max(0, maxScroll - scrollArea.scrollTop);
      const portBottom = areaRect.top + scrollArea.clientTop + scrollArea.clientHeight;
      const overlayTop = bottomControls
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          const position = window.getComputedStyle(control).position;
          return (position === "fixed" || position === "sticky") &&
            rect.top < portBottom && rect.bottom > areaRect.top;
        })
        .reduce((top, control) => Math.min(top, control.getBoundingClientRect().top), portBottom);
      if (predictedBottom > overlayTop + 1) {
        issues.push({
          screenId,
          semanticId: safeSemanticId(lastAction.id),
          issueType: "last-scroll-action-obscured",
          measurements: {
            predictedBottom: Math.round(predictedBottom * 100) / 100,
            safeBottom: Math.round(overlayTop * 100) / 100,
            maxScroll,
          },
        });
      }
    }
  }

  const menuOverflow = analyzeAdditionalMenuOverflow(root, adapter);
  if (menuOverflow.unreachable) {
    issues.push({
      screenId,
      semanticId: "menu.overflow",
      issueType: "menu-overflow-unreachable",
      measurements: {
        hiddenItems: menuOverflow.hiddenCount,
        scrollable: false,
        itemCount: menuOverflow.itemCount,
      },
    });
  }

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
      if (first.element === second.element ||
        first.element.contains(second.element) || second.element.contains(first.element)) continue;
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
