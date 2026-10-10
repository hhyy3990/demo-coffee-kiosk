import type { AccessibilityAdapter } from "./adapter.ts";
import { inspectKioskLayout, type AccessibilityDiagnostic } from "./diagnostics.ts";
import type { AccessibilityProfile } from "./profile.ts";

type StyleEntry = { value: string; priority: string };
type StyleBaseline = Map<string, StyleEntry>;

export interface LayoutCorrectionResult {
  strategy: "text-wrap" | "release-container-width" | "reduce-grid-columns" | "reserve-scroll-space" | "stack-action-group";
  outcome: "applied" | "reverted" | "not-needed";
  issuesBefore: number;
  issuesAfter: number;
}

const TEXT_SCALE = { standard: 1, large: 1.25, extraLarge: 1.5 } as const;
const CONTROL_SCALE = { standard: 1, large: 1.15 } as const;

function supported(): boolean {
  return typeof window !== "undefined" && typeof window.getComputedStyle === "function";
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createLayoutEnhancer(
  root: HTMLElement,
  adapter: AccessibilityAdapter,
  getProfile: () => AccessibilityProfile,
): {
  applyProfile(): void;
  correctLayout(): LayoutCorrectionResult[];
  getLastCorrections(): LayoutCorrectionResult[];
  restore(): void;
  destroy(): void;
} {
  const originals = new Map<HTMLElement, StyleBaseline>();
  const baseSizes = new WeakMap<HTMLElement, { font: number; height: number; paddingTop: number; paddingBottom: number }>();
  let destroyed = false;
  let lastResults: LayoutCorrectionResult[] = [];

  function remember(element: HTMLElement, property: string): void {
    let baseline = originals.get(element);
    if (!baseline) {
      baseline = new Map();
      originals.set(element, baseline);
    }
    if (!baseline.has(property)) {
      baseline.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
    }
  }

  function write(element: HTMLElement, property: string, value: string): void {
    remember(element, property);
    element.style.setProperty(property, value, "important");
  }

  function restoreElement(element: HTMLElement, forgetBaseline = false): void {
    const entries = originals.get(element);
    if (entries) {
      for (const [property, entry] of entries) {
        if (entry.value) element.style.setProperty(property, entry.value, entry.priority);
        else element.style.removeProperty(property);
      }
      originals.delete(element);
    }
    if (forgetBaseline) baseSizes.delete(element);
  }

  function captureBaseline(element: HTMLElement): void {
    if (baseSizes.has(element) || !supported()) return;
    const toggled = ["a11y-text-large", "a11y-text-extra", "a11y-controls-large"]
      .filter((name) => root.classList.contains(name));
    for (const name of toggled) root.classList.remove(name);
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    baseSizes.set(element, {
      font: px(style.fontSize),
      height: rect.height,
      paddingTop: px(style.paddingTop),
      paddingBottom: px(style.paddingBottom),
    });
    for (const name of toggled) root.classList.add(name);
  }

  function currentTargets(): HTMLElement[] {
    const set = new Set<HTMLElement>();
    for (const { element } of adapter.getTextTargets()) if (root.contains(element)) set.add(element);
    for (const { element } of adapter.getActions()) if (root.contains(element)) set.add(element);
    return [...set];
  }

  function refreshProfile(): void {
    if (destroyed || !supported()) return;
    const targets = currentTargets();
    const live = new Set(targets);
    for (const element of [...originals.keys()]) {
      if (!live.has(element)) restoreElement(element, true);
      else restoreElement(element);
    }
    const profile = getProfile();
    const textScale = TEXT_SCALE[profile.textSize];
    const controlScale = CONTROL_SCALE[profile.buttonSize];
    for (const element of targets) {
      captureBaseline(element);
      const style = window.getComputedStyle(element);
      const size = baseSizes.get(element)!;
      if (textScale > 1 && size.font > 0) {
        write(element, "font-size", `${size.font * textScale}px`);
        if (style.lineHeight !== "normal" && px(style.lineHeight) > 0) {
          write(element, "line-height", `${Math.max(px(style.lineHeight) * textScale, size.font * textScale * 1.2)}px`);
        }
        write(element, "max-width", "100%");
      }
    }
    if (controlScale > 1) {
      for (const { element } of adapter.getActions()) {
        if (!root.contains(element)) continue;
        const size = baseSizes.get(element);
        if (!size) continue;
        write(element, "box-sizing", "border-box");
        write(element, "height", "auto");
        write(element, "min-height", `${Math.max(48, size.height * controlScale)}px`);
        write(element, "padding-top", `${Math.max(8, size.paddingTop * controlScale)}px`);
        write(element, "padding-bottom", `${Math.max(8, size.paddingBottom * controlScale)}px`);
        write(element, "white-space", "normal");
        write(element, "overflow-wrap", "anywhere");
      }
    }
  }

  function tryCorrection(
    strategy: LayoutCorrectionResult["strategy"],
    elements: readonly HTMLElement[],
    changes: (element: HTMLElement) => void,
    relevant: (issue: AccessibilityDiagnostic) => boolean,
  ): LayoutCorrectionResult {
    const before = inspectKioskLayout(root, adapter);
    const beforeCount = before.filter(relevant).length;
    if (beforeCount === 0 || elements.length === 0) {
      return { strategy, outcome: "not-needed", issuesBefore: beforeCount, issuesAfter: beforeCount };
    }
    const snapshot = new Map<HTMLElement, Map<string, StyleEntry>>();
    for (const element of elements) {
      const properties = new Map<string, StyleEntry>();
      snapshot.set(element, properties);
      for (const property of ["white-space", "overflow-wrap", "height", "min-height", "min-width", "max-width", "grid-template-columns", "padding-bottom", "display", "flex-direction", "align-items", "gap"]) {
        properties.set(property, {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        });
      }
      changes(element);
    }
    const afterIssues = inspectKioskLayout(root, adapter);
    const afterCount = afterIssues.filter(relevant).length;
    const introducedIssue = afterIssues.some((issue) => !before.some((previous) =>
      previous.issueType === issue.issueType &&
      previous.semanticId === issue.semanticId &&
      previous.relatedSemanticId === issue.relatedSemanticId,
    ));
    if (afterCount < beforeCount && !introducedIssue) {
      return { strategy, outcome: "applied", issuesBefore: beforeCount, issuesAfter: afterCount };
    }
    for (const [element, properties] of snapshot) {
      for (const [property, value] of properties) {
        if (value.value) element.style.setProperty(property, value.value, value.priority);
        else element.style.removeProperty(property);
      }
    }
    return { strategy, outcome: "reverted", issuesBefore: beforeCount, issuesAfter: afterCount };
  }

  function correctLayout(): LayoutCorrectionResult[] {
    if (!supported()) return [];
    const issues = inspectKioskLayout(root, adapter);
    const results: LayoutCorrectionResult[] = [];
    const regions = adapter.getLayoutRegions();
    const clippedIds = new Set(issues.filter((issue) => issue.issueType === "text-clipped").map((issue) => issue.semanticId));
    if (clippedIds.size) {
      const targets = adapter.getTextTargets().filter((target) => clippedIds.has(target.id)).map(({ element }) => element);
      results.push(tryCorrection("text-wrap", targets, (element) => {
        write(element, "white-space", "normal");
        write(element, "overflow-wrap", "anywhere");
        write(element, "height", "auto");
        write(element, "min-height", "0");
      }, (issue) => issue.issueType === "text-clipped"));
    }
    if (issues.some((issue) => issue.issueType === "horizontal-overflow" || issue.issueType === "action-overlap")) {
      results.push(tryCorrection("release-container-width", regions.reflowContainers ?? [], (element) => {
        write(element, "min-width", "0");
        write(element, "max-width", "100%");
      }, (issue) => issue.issueType === "horizontal-overflow"));
      results.push(tryCorrection("reduce-grid-columns", regions.gridContainers ?? [], (element) => {
        if (window.getComputedStyle(element).display === "grid") {
          write(element, "grid-template-columns", "minmax(0, 1fr)");
        }
      }, (issue) => issue.issueType === "horizontal-overflow" || issue.issueType === "action-overlap"));
      if (issues.some((issue) => issue.issueType === "action-overlap")) {
        results.push(tryCorrection("stack-action-group", regions.actionGroups ?? [], (element) => {
          write(element, "display", "flex");
          write(element, "flex-direction", "column");
          write(element, "align-items", "stretch");
          write(element, "gap", "8px");
        }, (issue) => issue.issueType === "action-overlap"));
      }
    }
    if (issues.some((issue) => issue.issueType === "bottom-control-obscures-action") && regions.scrollArea) {
      const height = (regions.bottomControls ?? []).reduce((sum, control) => sum + control.getBoundingClientRect().height, 0);
      results.push(tryCorrection("reserve-scroll-space", [regions.scrollArea], (element) => {
        const existing = px(window.getComputedStyle(element).paddingBottom);
        write(element, "padding-bottom", `${existing + height}px`);
      }, (issue) => issue.issueType === "bottom-control-obscures-action"));
    }
    lastResults = results;
    return [...lastResults];
  }

  function restore(): void {
    for (const element of [...new Set([...originals.keys(), ...currentTargets()])]) {
      restoreElement(element, true);
    }
  }

  const observer = typeof MutationObserver !== "undefined" && typeof root.nodeType === "number"
    ? new MutationObserver(() => {
        refreshProfile();
        const profile = getProfile();
        if (profile.textSize !== "standard" || profile.buttonSize === "large" || profile.bottomControls) {
          correctLayout();
        }
      })
    : null;
  observer?.observe(root, { childList: true, subtree: true });
  if (supported()) {
    for (const element of currentTargets()) captureBaseline(element);
  }

  return {
    applyProfile() { refreshProfile(); },
    correctLayout,
    getLastCorrections: () => [...lastResults],
    restore,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      restore();
    },
  };
}
