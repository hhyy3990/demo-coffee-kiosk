import type { AccessibilityAdapter } from "./adapter.ts";

export type BottomViewportPocPercent = 60 | 70 | 80;

export interface BottomViewportPocOptions {
  root: HTMLElement;
  adapter: AccessibilityAdapter;
  percent: BottomViewportPocPercent;
}

/**
 * Experimental bottom viewport shell. It changes the scroll owner without moving
 * host nodes; the host remains responsible for deciding when the experiment ends.
 */
export function createBottomViewportPoc({
  root,
  adapter,
  percent,
}: BottomViewportPocOptions): { destroy(): void } {
  const rootHadClass = root.classList.contains("a11y-bottom-viewport-poc-shell");
  const oldHeight = root.style.getPropertyValue("--a11y-bottom-poc-height");
  const oldHeightPriority = root.style.getPropertyPriority("--a11y-bottom-poc-height");
  const overlayState = new Map<HTMLElement, { hadClass: boolean; maxHeight: string; priority: string }>();
  let destroyed = false;
  root.classList.add("a11y-bottom-viewport-poc-shell");
  root.style.setProperty("--a11y-bottom-poc-height", `${percent}dvh`);

  const updateOverlays = () => {
    for (const overlay of adapter.getLayoutRegions().viewportOverlays ?? []) {
      if (overlayState.has(overlay)) continue;
      overlayState.set(overlay, {
        hadClass: overlay.classList.contains("a11y-bottom-viewport-poc-overlay"),
        maxHeight: overlay.style.getPropertyValue("--a11y-bottom-poc-dialog-max"),
        priority: overlay.style.getPropertyPriority("--a11y-bottom-poc-dialog-max"),
      });
      overlay.classList.add("a11y-bottom-viewport-poc-overlay");
      overlay.style.setProperty("--a11y-bottom-poc-dialog-max", `calc(${percent}dvh - 24px)`);
    }
  };
  updateOverlays();
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(updateOverlays);
  observer?.observe(root, { childList: true, subtree: true });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      root.classList.toggle("a11y-bottom-viewport-poc-shell", rootHadClass);
      if (oldHeight) root.style.setProperty("--a11y-bottom-poc-height", oldHeight, oldHeightPriority);
      else root.style.removeProperty("--a11y-bottom-poc-height");
      for (const [overlay, state] of overlayState) {
        if (!state.hadClass) overlay.classList.remove("a11y-bottom-viewport-poc-overlay");
        if (state.maxHeight) overlay.style.setProperty("--a11y-bottom-poc-dialog-max", state.maxHeight, state.priority);
        else overlay.style.removeProperty("--a11y-bottom-poc-dialog-max");
      }
      overlayState.clear();
    },
  };
}
