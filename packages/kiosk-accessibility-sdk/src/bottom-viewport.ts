import type { AccessibilityAdapter } from "./adapter.ts";

export type BottomViewportHeightPercent = 60 | 70 | 80;

export interface BottomViewportConfig {
  mode: "bottom";
  heightPercent: BottomViewportHeightPercent;
}

const ROOT_CLASS = "a11y-bottom-viewport-enabled";
const SCROLL_CLASS = "a11y-bottom-viewport-scroll-area";
const OVERLAY_CLASS = "a11y-bottom-viewport-overlay";
const CONTROL_CLASS = "a11y-bottom-viewport-controls";
const HEIGHT_PROPERTY = "--a11y-bottom-viewport-height";
const LEFT_PROPERTY = "--a11y-bottom-viewport-left";
const WIDTH_PROPERTY = "--a11y-bottom-viewport-width";
const SAFE_INSET_PROPERTY = "--a11y-bottom-viewport-safe-inset";
const BASE_PADDING_PROPERTY = "--a11y-bottom-viewport-base-padding";
const BOTTOM_INSET_PROPERTY = "--a11y-bottom-viewport-bottom-inset";

type ElementState = {
  hadClass: boolean;
  height: string;
  heightPriority: string;
  left: string;
  leftPriority: string;
  width: string;
  widthPriority: string;
  safeInset: string;
  safeInsetPriority: string;
  basePadding: string;
  basePaddingPriority: string;
  bottomInset: string;
  bottomInsetPriority: string;
  paddingBottom: string;
  paddingBottomPriority: string;
};

function validConfig(input: unknown): input is BottomViewportConfig {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return value.mode === "bottom" &&
    (value.heightPercent === 60 || value.heightPercent === 70 || value.heightPercent === 80);
}

export function createBottomViewportController(root: HTMLElement, adapter: AccessibilityAdapter) {
  let config: BottomViewportConfig | null = null;
  let target: HTMLElement | null = null;
  let targetState: ElementState | null = null;
  let rootHadClass = false;
  let rootClassCaptured = false;
  let rootCaptured = false;
  let rootHeight = "";
  let rootHeightPriority = "";
  let rootBottomInset = "";
  let rootBottomInsetPriority = "";
  let destroyed = false;
  const overlays = new Map<HTMLElement, ElementState>();
  const controls = new Map<HTMLElement, ElementState>();
  const observedDocks = new Set<HTMLElement>();
  const dockResizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => {
      if (config) configureTarget();
    });

  const capture = (element: HTMLElement, className: string): ElementState => ({
    hadClass: element.classList.contains(className),
    height: element.style.getPropertyValue(HEIGHT_PROPERTY),
    heightPriority: element.style.getPropertyPriority(HEIGHT_PROPERTY),
    left: element.style.getPropertyValue(LEFT_PROPERTY),
    leftPriority: element.style.getPropertyPriority(LEFT_PROPERTY),
    width: element.style.getPropertyValue(WIDTH_PROPERTY),
    widthPriority: element.style.getPropertyPriority(WIDTH_PROPERTY),
    safeInset: element.style.getPropertyValue(SAFE_INSET_PROPERTY),
    safeInsetPriority: element.style.getPropertyPriority(SAFE_INSET_PROPERTY),
    basePadding: element.style.getPropertyValue(BASE_PADDING_PROPERTY),
    basePaddingPriority: element.style.getPropertyPriority(BASE_PADDING_PROPERTY),
    bottomInset: element.style.getPropertyValue(BOTTOM_INSET_PROPERTY),
    bottomInsetPriority: element.style.getPropertyPriority(BOTTOM_INSET_PROPERTY),
    paddingBottom: element.style.getPropertyValue("padding-bottom"),
    paddingBottomPriority: element.style.getPropertyPriority("padding-bottom"),
  });
  const restoreElement = (element: HTMLElement, className: string, state: ElementState) => {
    if (!state.hadClass) element.classList.remove(className);
    if (state.height) element.style.setProperty(HEIGHT_PROPERTY, state.height, state.heightPriority);
    else element.style.removeProperty(HEIGHT_PROPERTY);
    if (state.left) element.style.setProperty(LEFT_PROPERTY, state.left, state.leftPriority);
    else element.style.removeProperty(LEFT_PROPERTY);
    if (state.width) element.style.setProperty(WIDTH_PROPERTY, state.width, state.widthPriority);
    else element.style.removeProperty(WIDTH_PROPERTY);
    if (state.safeInset) element.style.setProperty(SAFE_INSET_PROPERTY, state.safeInset, state.safeInsetPriority);
    else element.style.removeProperty(SAFE_INSET_PROPERTY);
    if (state.basePadding) element.style.setProperty(BASE_PADDING_PROPERTY, state.basePadding, state.basePaddingPriority);
    else element.style.removeProperty(BASE_PADDING_PROPERTY);
    if (state.bottomInset) element.style.setProperty(BOTTOM_INSET_PROPERTY, state.bottomInset, state.bottomInsetPriority);
    else element.style.removeProperty(BOTTOM_INSET_PROPERTY);
    if (state.paddingBottom) element.style.setProperty("padding-bottom", state.paddingBottom, state.paddingBottomPriority);
    else element.style.removeProperty("padding-bottom");
  };

  function restoreTarget(): void {
    if (target && targetState) restoreElement(target, SCROLL_CLASS, targetState);
    target = null;
    targetState = null;
  }

  function resolveTarget(): HTMLElement {
    const area = adapter.getLayoutRegions().scrollArea;
    const docScroll = document.scrollingElement;
    return area && root.contains(area) && area !== docScroll ? area : root;
  }

  function getAnchoredControls(area: HTMLElement): HTMLElement[] {
    const activeRect = area.getBoundingClientRect();
    const qrDocks = typeof document === "undefined"
      ? []
      : [...document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]")];
    const candidates = [...new Set([...(adapter.getLayoutRegions().bottomControls ?? []), ...qrDocks])];
    return candidates.filter((element) => {
      if (!element.isConnected) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || !["fixed", "sticky"].includes(style.position)) return false;
      const control = element.getBoundingClientRect();
      return control.width > 0 && control.height > 0 &&
        control.right > activeRect.left && control.left < activeRect.right;
    });
  }

  function getBottomInset(elements: readonly HTMLElement[]): number {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    let safeEdge = viewportHeight;
    let changed = true;
    while (changed) {
      changed = false;
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.top < safeEdge && rect.bottom >= safeEdge - 1) {
          safeEdge = rect.top;
          changed = true;
        }
      }
    }
    return Math.max(0, viewportHeight - safeEdge);
  }

  function applyOverlays(): void {
    if (!config) return;
    const current = new Set(adapter.getLayoutRegions().viewportOverlays ?? []);
    for (const [overlay, state] of overlays) {
      if (!current.has(overlay) || !overlay.isConnected) {
        restoreElement(overlay, OVERLAY_CLASS, state);
        overlays.delete(overlay);
      }
    }
    for (const overlay of current) {
      if (!overlays.has(overlay)) {
        overlays.set(overlay, capture(overlay, OVERLAY_CLASS));
        overlay.classList.add(OVERLAY_CLASS);
      }
      overlay.style.setProperty(HEIGHT_PROPERTY, `${config.heightPercent}dvh`);
      overlay.style.setProperty(
        BOTTOM_INSET_PROPERTY,
        root.style.getPropertyValue(BOTTOM_INSET_PROPERTY) || "0px",
      );
    }
  }

  function configureTarget(): void {
    if (!config) return;
    const next = resolveTarget();
    if (next !== target) {
      restoreTarget();
      target = next;
      targetState = capture(target, SCROLL_CLASS);
      target.classList.add(SCROLL_CLASS);
    }
    if (!rootClassCaptured) {
      rootHadClass = root.classList.contains(ROOT_CLASS);
      rootClassCaptured = true;
    }
    if (!rootCaptured) {
      rootHeight = root.style.getPropertyValue(HEIGHT_PROPERTY);
      rootHeightPriority = root.style.getPropertyPriority(HEIGHT_PROPERTY);
      rootBottomInset = root.style.getPropertyValue(BOTTOM_INSET_PROPERTY);
      rootBottomInsetPriority = root.style.getPropertyPriority(BOTTOM_INSET_PROPERTY);
      rootCaptured = true;
    }
    root.classList.add(ROOT_CLASS);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const currentControls = getAnchoredControls(target);
    const bottomInset = getBottomInset(currentControls);
    const currentDocks = new Set(currentControls.filter((element) =>
      element.hasAttribute("data-a11y-qr-entry-dock")));
    for (const dock of observedDocks) {
      if (!currentDocks.has(dock)) {
        dockResizeObserver?.unobserve(dock);
        observedDocks.delete(dock);
      }
    }
    for (const dock of currentDocks) {
      if (!observedDocks.has(dock)) {
        dockResizeObserver?.observe(dock);
        observedDocks.add(dock);
      }
    }
    const availableHeight = Math.max(0, viewportHeight - bottomInset);
    const targetHeight = Math.floor(availableHeight * config.heightPercent / 100);
    root.style.setProperty(HEIGHT_PROPERTY, `${targetHeight}px`);
    root.style.setProperty(BOTTOM_INSET_PROPERTY, `${bottomInset}px`);
    target.style.setProperty(HEIGHT_PROPERTY, `${targetHeight}px`);
    target.style.setProperty(BOTTOM_INSET_PROPERTY, `${bottomInset}px`);
    const targetIsRoot = target === root;
    target.classList.remove(SCROLL_CLASS);
    if (targetIsRoot) root.classList.remove(ROOT_CLASS);
    const naturalRect = target.getBoundingClientRect();
    const previousPadding = target.style.getPropertyValue("padding-bottom");
    const previousPaddingPriority = target.style.getPropertyPriority("padding-bottom");
    if (targetState?.paddingBottom) {
      target.style.setProperty("padding-bottom", targetState.paddingBottom, targetState.paddingBottomPriority);
    } else {
      target.style.removeProperty("padding-bottom");
    }
    const basePadding = Number.parseFloat(getComputedStyle(target).paddingBottom) || 0;
    if (previousPadding) target.style.setProperty("padding-bottom", previousPadding, previousPaddingPriority);
    else target.style.removeProperty("padding-bottom");
    if (targetIsRoot) root.classList.add(ROOT_CLASS);
    target.classList.add(SCROLL_CLASS);
    target.style.setProperty(LEFT_PROPERTY, `${Math.round(naturalRect.left)}px`);
    target.style.setProperty(WIDTH_PROPERTY, `${Math.round(naturalRect.width)}px`);
    target.style.setProperty(BASE_PADDING_PROPERTY, `${basePadding}px`);
    const activeRect = target.getBoundingClientRect();
    const intersectingControls = currentControls.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > activeRect.top && rect.top < activeRect.bottom;
    });
    for (const [element, state] of controls) {
      if (!currentControls.includes(element)) {
        restoreElement(element, CONTROL_CLASS, state);
        controls.delete(element);
      }
    }
    for (const element of currentControls) {
      if (!controls.has(element)) {
        controls.set(element, capture(element, CONTROL_CLASS));
        element.classList.add(CONTROL_CLASS);
      }
    }
    const occlusion = intersectingControls.reduce((bottom, element) =>
      Math.min(bottom, element.getBoundingClientRect().top), activeRect.bottom);
    const safeInset = Math.max(0, activeRect.bottom - occlusion - basePadding);
    target.style.setProperty(SAFE_INSET_PROPERTY, `${safeInset}px`);
    target.style.setProperty("padding-bottom", `calc(${basePadding}px + ${safeInset}px)`, "important");
    applyOverlays();
  }

  function restore(): void {
    if (config === null && !rootCaptured && target === null && overlays.size === 0) return;
    config = null;
    restoreTarget();
    for (const [overlay, state] of overlays) restoreElement(overlay, OVERLAY_CLASS, state);
    overlays.clear();
    for (const [control, state] of controls) restoreElement(control, CONTROL_CLASS, state);
    controls.clear();
    if (!rootHadClass) root.classList.remove(ROOT_CLASS);
    if (rootHeight) root.style.setProperty(HEIGHT_PROPERTY, rootHeight, rootHeightPriority);
    else root.style.removeProperty(HEIGHT_PROPERTY);
    rootHadClass = false;
    rootClassCaptured = false;
    rootHeight = "";
    rootHeightPriority = "";
    if (rootBottomInset) root.style.setProperty(BOTTOM_INSET_PROPERTY, rootBottomInset, rootBottomInsetPriority);
    else root.style.removeProperty(BOTTOM_INSET_PROPERTY);
    rootBottomInset = "";
    rootBottomInsetPriority = "";
    rootCaptured = false;
  }

  const observer = typeof MutationObserver === "undefined"
    ? null
    : new MutationObserver(() => {
      if (!config) return;
      const nextTarget = resolveTarget();
      const currentControls = getAnchoredControls(target ?? nextTarget);
      const existingControls = [...controls.keys()].filter((element) => element.isConnected);
      const sameControls = currentControls.length === existingControls.length &&
        currentControls.every((element) => controls.has(element));
      if (nextTarget !== target || !sameControls) configureTarget();
      else applyOverlays();
    });
  const dockObserver = typeof MutationObserver === "undefined" || typeof document === "undefined" ||
      !document.body
    ? null
    : new MutationObserver(() => {
      if (!config || !target) return;
      const liveDocks = typeof document === "undefined"
        ? []
        : [...document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]")];
      const trackedDocks = [...controls.keys()].filter((element) =>
        element.hasAttribute("data-a11y-qr-entry-dock"));
      if (liveDocks.length !== trackedDocks.length ||
          liveDocks.some((element) => !controls.has(element))) configureTarget();
    });
  observer?.observe(root, { childList: true, subtree: true });
  if (dockObserver && document.body) dockObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", configureTarget, { passive: true });

  return {
    apply(input: BottomViewportConfig | null): boolean {
      if (input === null) {
        restore();
        return true;
      }
      if (!validConfig(input) || destroyed) return false;
      config = { mode: input.mode, heightPercent: input.heightPercent };
      configureTarget();
      return true;
    },
    refresh(): void {
      configureTarget();
    },
    destroy(): void {
      if (destroyed) return;
      restore();
      observer?.disconnect();
      dockObserver?.disconnect();
      dockResizeObserver?.disconnect();
      observedDocks.clear();
      window.removeEventListener("resize", configureTarget);
      destroyed = true;
    },
  };
}
