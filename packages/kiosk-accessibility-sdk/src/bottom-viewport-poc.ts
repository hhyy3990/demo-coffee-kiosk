import type { AccessibilityAdapter } from "./adapter.ts";

export type BottomViewportPocPercent = 60 | 70 | 80;

export interface BottomViewportPocOptions {
  root: HTMLElement;
  adapter: AccessibilityAdapter;
  percent: BottomViewportPocPercent;
}

export interface QrEntryAreaPocOptions {
  root: HTMLElement;
  onOpenQr(): void;
  adapter?: AccessibilityAdapter;
  percent?: BottomViewportPocPercent;
  label?: string;
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

/**
 * Experimental SDK-owned QR entry area. The host decides when it is mounted
 * and supplies only the existing QR-opening action; no host DOM is moved.
 */
export function createQrEntryAreaPoc({
  root,
  onOpenQr,
  adapter,
  percent,
  label = "내 QR로 화면 설정",
}: QrEntryAreaPocOptions): { destroy(): void } {
  const homeClass = "a11y-qr-entry-poc-home";
  const bottomClass = "a11y-qr-entry-poc-bottom";
  const hadHomeClass = root.classList.contains(homeClass);
  const hadBottomClass = root.classList.contains(bottomClass);
  const oldHeight = root.style.getPropertyValue("--a11y-qr-entry-poc-height");
  const oldHeightPriority = root.style.getPropertyPriority("--a11y-qr-entry-poc-height");
  const oldContentHeight = root.style.getPropertyValue("--a11y-qr-entry-poc-content-height");
  const oldContentHeightPriority = root.style.getPropertyPriority("--a11y-qr-entry-poc-content-height");
  const oldControlsInset = root.style.getPropertyValue("--a11y-qr-entry-poc-controls-inset");
  const oldControlsInsetPriority = root.style.getPropertyPriority("--a11y-qr-entry-poc-controls-inset");
  const footer = document.createElement("aside");
  const button = document.createElement("button");
  let destroyed = false;

  footer.className = "a11y-qr-entry-poc";
  footer.dataset.a11yQrEntryFooter = "true";
  footer.setAttribute("aria-label", "QR 화면 설정");
  button.type = "button";
  button.className = "a11y-qr-entry-poc-button";
  button.setAttribute("aria-label", label);
  button.innerHTML = '<svg class="a11y-qr-entry-poc-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM19 19h2v2h-2zM14 19h2v2h-2z"/></svg><span></span>';
  button.querySelector("span:last-child")!.textContent = label;
  button.addEventListener("click", onOpenQr);
  footer.append(button);
  document.body.append(footer);
  root.classList.add(homeClass);
  if (percent) {
    root.classList.add(bottomClass);
  }

  const updateMeasurements = () => {
    if (destroyed) return;
    const height = Math.max(64, Math.ceil(footer.getBoundingClientRect().height));
    const controls = adapter?.getLayoutRegions().bottomControls ?? [];
    const controlsInset = Math.ceil(controls.reduce((inset, element) => {
      if (!element.isConnected) return inset;
      const style = getComputedStyle(element);
      if (style.display === "none" || !["fixed", "sticky"].includes(style.position)) return inset;
      const rect = element.getBoundingClientRect();
      return rect.bottom >= window.innerHeight - 1 && rect.top < window.innerHeight
        ? Math.max(inset, window.innerHeight - rect.top)
        : inset;
    }, 0));
    root.style.setProperty("--a11y-qr-entry-poc-height", `${height}px`);
    root.style.setProperty("--a11y-qr-entry-poc-controls-inset", `${controlsInset}px`);
    footer.style.setProperty("--a11y-qr-entry-poc-controls-inset", `${controlsInset}px`);
    if (percent) {
      const availableHeight = Math.max(0, window.innerHeight - height - controlsInset);
      root.style.setProperty(
        "--a11y-qr-entry-poc-content-height",
        `${Math.floor(availableHeight * percent / 100)}px`,
      );
    }
    const rootStyle = getComputedStyle(root);
    footer.style.fontFamily = rootStyle.fontFamily;
    footer.style.fontSize = rootStyle.fontSize;
    footer.classList.toggle("a11y-qr-entry-poc-contrast", root.classList.contains("a11y-high-contrast"));
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMeasurements);
  resizeObserver?.observe(footer);
  const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(updateMeasurements);
  mutationObserver?.observe(root, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  window.addEventListener("resize", updateMeasurements, { passive: true });
  updateMeasurements();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updateMeasurements);
      button.removeEventListener("click", onOpenQr);
      footer.remove();
      if (!hadHomeClass) root.classList.remove(homeClass);
      if (!hadBottomClass) root.classList.remove(bottomClass);
      if (oldHeight) root.style.setProperty("--a11y-qr-entry-poc-height", oldHeight, oldHeightPriority);
      else root.style.removeProperty("--a11y-qr-entry-poc-height");
      if (oldContentHeight) root.style.setProperty("--a11y-qr-entry-poc-content-height", oldContentHeight, oldContentHeightPriority);
      else root.style.removeProperty("--a11y-qr-entry-poc-content-height");
      if (oldControlsInset) root.style.setProperty("--a11y-qr-entry-poc-controls-inset", oldControlsInset, oldControlsInsetPriority);
      else root.style.removeProperty("--a11y-qr-entry-poc-controls-inset");
    },
  };
}
