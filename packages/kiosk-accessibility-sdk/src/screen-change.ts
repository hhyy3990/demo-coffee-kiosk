import type { AccessibilityAdapter } from "./adapter.ts";

export type KioskScreenId = string;

export interface ScreenChangeController {
  notify(screenId: KioskScreenId): boolean;
  reset(): void;
  destroy(): void;
}

const USER_INPUT_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

function isScrollable(element: HTMLElement, documentScroller: HTMLElement | null): boolean {
  if (!element.isConnected) return false;
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  if (element === documentScroller) return true;
  const overflowY = getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || element.classList.contains("a11y-bottom-viewport-scroll-area");
}

export function createScreenChangeController(
  root: HTMLElement,
  adapter: AccessibilityAdapter,
  refreshLayout: () => void,
): ScreenChangeController {
  let currentScreenId: KioskScreenId | null = null;
  let previousOwners: HTMLElement[] = [];
  let generation = 0;
  let frame = 0;
  let destroyed = false;
  let removePendingListeners: (() => void) | null = null;
  const ids = new WeakMap<HTMLElement, number>();
  let nextElementId = 1;

  const getElementId = (element: HTMLElement) => {
    let id = ids.get(element);
    if (id === undefined) {
      id = nextElementId++;
      ids.set(element, id);
    }
    return id;
  };

  function findOwners(): HTMLElement[] {
    const docScroller = typeof document === "undefined"
      ? null
      : document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : null;
    const regions = adapter.getLayoutRegions();
    const registered = regions.scrollArea && root.contains(regions.scrollArea)
      ? regions.scrollArea
      : root;
    const candidates = [...new Set([registered, root, docScroller].filter(
      (element): element is HTMLElement => !!element,
    ))].filter((element) => isScrollable(element, docScroller));
    const displaced = candidates.filter((element) => element.scrollTop > 1);
    if (displaced.length > 0) return displaced;
    if (candidates.includes(registered)) return [registered];
    if (docScroller && candidates.includes(docScroller)) return [docScroller];
    return registered.isConnected ? [registered] : [];
  }

  function cancelPending(): void {
    generation += 1;
    if (frame && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
    }
    frame = 0;
    removePendingListeners?.();
    removePendingListeners = null;
  }

  function notify(screenId: KioskScreenId): boolean {
    const normalized = typeof screenId === "string" ? screenId.trim() : "";
    if (!normalized || normalized.length > 200 || destroyed || normalized === currentScreenId) return false;
    cancelPending();
    currentScreenId = normalized;
    const requestGeneration = generation;
    const touchedOwners = new Set<HTMLElement>();
    let previousSignature = "";
    let stableFrames = 0;
    let frameCount = 0;
    let cancelledByUser = false;

    const onUserInput = () => {
      cancelledByUser = true;
      cancelPending();
    };
    for (const eventName of USER_INPUT_EVENTS) {
      window.addEventListener(eventName, onUserInput, { capture: true, passive: true, once: true });
    }
    removePendingListeners = () => {
      for (const eventName of USER_INPUT_EVENTS) {
        window.removeEventListener(eventName, onUserInput, true);
      }
    };

    const run = () => {
      frame = 0;
      if (destroyed || cancelledByUser || requestGeneration !== generation) return;
      frameCount += 1;

      try {
        refreshLayout();
      } catch {
        // A host may temporarily expose incomplete layout regions during a transition.
      }
      const owners = findOwners();
      const allOwners = [...new Set([...previousOwners, ...owners])];
      const signature = owners.map((element) => {
        const rect = element.getBoundingClientRect();
        return `${getElementId(element)}:${element.clientHeight}:${element.scrollHeight}:${Math.round(rect.top)}:${Math.round(rect.height)}`;
      }).join("|");
      const changed = signature !== previousSignature;
      stableFrames = changed ? 0 : stableFrames + 1;
      previousSignature = signature;

      // Reset only the previous and currently resolved owner(s), never arbitrary descendants.
      for (const owner of allOwners) {
        if (!touchedOwners.has(owner) || owner.scrollTop > 1) {
          owner.scrollTop = 0;
          touchedOwners.add(owner);
        }
      }
      previousOwners = owners;

      if (frameCount >= 8 || (frameCount >= 3 && stableFrames >= 2)) {
        removePendingListeners?.();
        removePendingListeners = null;
        return;
      }
      frame = window.requestAnimationFrame(run);
    };

    // Let the host commit its new DOM, then remeasure SDK viewport/QR dock geometry.
    frame = window.requestAnimationFrame(() => {
      if (requestGeneration !== generation || cancelledByUser) return;
      frame = window.requestAnimationFrame(run);
    });
    return true;
  }

  function reset(): void {
    cancelPending();
    currentScreenId = null;
    previousOwners = [];
  }

  return {
    notify,
    reset,
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
    },
  };
}
