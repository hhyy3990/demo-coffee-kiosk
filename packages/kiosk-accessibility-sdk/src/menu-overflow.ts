import type { AccessibilityAdapter } from "./adapter.ts";

export const DEFAULT_ADDITIONAL_MENU_MESSAGE =
  "아래에도 내용이 있어요";

export interface AdditionalMenuOverflowState {
  itemCount: number;
  hiddenCount: number;
  hasMoreBelow: boolean;
  canScrollBelow: boolean;
  unreachable: boolean;
  clipBottom: number;
  scrollOwner: HTMLElement | Document | null;
}

function visible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
}

function elementCanScroll(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return ["auto", "scroll", "overlay"].includes(style.overflowY) &&
    element.scrollHeight > element.clientHeight + 1;
}

function documentCanScroll(): boolean {
  const doc = document.scrollingElement ?? document.documentElement;
  const style = window.getComputedStyle(document.documentElement);
  const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
  const permitted = (value: string) => value !== "hidden" && value !== "clip";
  return permitted(style.overflowY) && (!bodyStyle || permitted(bodyStyle.overflowY)) &&
    doc.scrollHeight > doc.clientHeight + 1;
}

function findScrollOwner(
  root: HTMLElement,
  items: readonly HTMLElement[],
  explicitArea: HTMLElement | null | undefined,
): HTMLElement | Document | null {
  const candidates = new Set<HTMLElement>();
  if (explicitArea && root.contains(explicitArea)) candidates.add(explicitArea);
  for (const item of items) {
    for (let current: HTMLElement | null = item; current && root.contains(current); current = current.parentElement) {
      candidates.add(current);
      if (current === root) break;
    }
  }
  for (const candidate of candidates) {
    if (elementCanScroll(candidate)) return candidate;
  }
  return documentCanScroll() ? document : null;
}

function ownerCanScrollBelow(owner: HTMLElement | Document | null): boolean {
  if (!owner) return false;
  if (owner instanceof Document) {
    const scrollingElement = owner.scrollingElement ?? owner.documentElement;
    return window.scrollY < scrollingElement.scrollHeight - scrollingElement.clientHeight - 1;
  }
  return owner.scrollTop < owner.scrollHeight - owner.clientHeight - 1;
}

function visibleBottomFor(
  item: HTMLElement,
  root: HTMLElement,
  controls: readonly HTMLElement[],
): number {
  let bottom = document.documentElement.clientHeight || window.innerHeight;
  for (let ancestor: HTMLElement | null = item.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (["auto", "scroll", "overlay", "hidden", "clip"].includes(style.overflowY)) {
      const rect = ancestor.getBoundingClientRect();
      bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
    }
    if (ancestor === root) break;
  }
  const itemRect = item.getBoundingClientRect();
  for (const control of controls) {
    if (!control.isConnected || !visible(control)) continue;
    const position = window.getComputedStyle(control).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const rect = control.getBoundingClientRect();
    if (itemRect.left < rect.right && itemRect.right > rect.left && rect.top < bottom && rect.bottom > itemRect.top) {
      bottom = Math.min(bottom, rect.top);
    }
  }
  return bottom;
}

export function analyzeAdditionalMenuOverflow(
  root: HTMLElement,
  adapter: AccessibilityAdapter,
): AdditionalMenuOverflowState {
  const regions = adapter.getLayoutRegions();
  const registeredItems = regions.menuItems ?? [];
  if (
    registeredItems.length === 0 ||
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return {
      itemCount: 0,
      hiddenCount: 0,
      hasMoreBelow: false,
      canScrollBelow: false,
      unreachable: false,
      clipBottom: 0,
      scrollOwner: null,
    };
  }
  const items = registeredItems.filter((item) =>
    root.contains(item) && item.isConnected && visible(item),
  );
  let hiddenCount = 0;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > visibleBottomFor(item, root, regions.bottomControls ?? []) + 1) hiddenCount += 1;
  }
  const scrollOwner = findScrollOwner(root, items, regions.scrollArea);
  const canScrollBelow = hiddenCount > 0 && ownerCanScrollBelow(scrollOwner);
  return {
    itemCount: items.length,
    hiddenCount,
    hasMoreBelow: hiddenCount > 0 && canScrollBelow,
    canScrollBelow,
    unreachable: hiddenCount > 0 && !canScrollBelow,
    clipBottom: items.length
      ? Math.min(...items.map((item) => visibleBottomFor(item, root, regions.bottomControls ?? [])))
      : document.documentElement.clientHeight || window.innerHeight,
    scrollOwner,
  };
}

export function createAdditionalMenuHint(
  root: HTMLElement,
  adapter: AccessibilityAdapter,
): {
  refresh(): void;
  clear(): void;
  destroy(): void;
} {
  let hint: HTMLElement | null = null;
  let frame = 0;
  let destroyed = false;
  const observed = new Set<Element>();
  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => refresh());

  function schedule(): void {
    if (destroyed || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  function ensureHint(): HTMLElement {
    if (hint) return hint;
    hint = document.createElement("aside");
    hint.className = "a11y-additional-menu-hint";
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    hint.setAttribute("aria-atomic", "true");
    hint.innerHTML = '<span aria-hidden="true">↓</span><span class="a11y-additional-menu-copy"></span>';
    root.append(hint);
    return hint;
  }

  function place(element: HTMLElement): boolean {
    const regions = adapter.getLayoutRegions();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const width = Math.min(360, viewportWidth - 24);
    const left = Math.max(12, (viewportWidth - width) / 2);
    element.style.width = `${width}px`;
    element.style.left = `${left}px`;
    element.style.top = "0px";
    element.style.visibility = "hidden";
    const measured = element.getBoundingClientRect();
    const height = Math.max(44, measured.height);
    const owner = findScrollOwner(root, regions.menuItems ?? [], regions.scrollArea);
    let safeBottom = owner && typeof Document !== "undefined" && owner instanceof Document
      ? viewportHeight
      : owner
        ? Math.min(viewportHeight, (owner as HTMLElement).getBoundingClientRect().top +
          (owner as HTMLElement).clientTop + (owner as HTMLElement).clientHeight)
        : viewportHeight;
    for (const control of regions.bottomControls ?? []) {
      if (!control.isConnected || !visible(control)) continue;
      const position = window.getComputedStyle(control).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const rect = control.getBoundingClientRect();
      const overlapsHintWidth = left < rect.right && left + width > rect.left;
      if (overlapsHintWidth && rect.bottom > 0 && rect.top < safeBottom) {
        safeBottom = Math.min(safeBottom, rect.top);
      }
    }
    const top = safeBottom - height - 12;
    if (top < 12) return false;
    element.style.top = `${top}px`;
    element.style.visibility = "visible";
    return true;
  }

  function refresh(): void {
    if (destroyed) return;
    const regions = adapter.getLayoutRegions();
    const items = regions.menuItems ?? [];
    const nextObserved = new Set<Element>([
      root,
      ...(regions.scrollArea ? [regions.scrollArea] : []),
      ...items,
      ...(regions.bottomControls ?? []),
    ]);
    for (const element of observed) {
      if (!nextObserved.has(element)) {
        resizeObserver?.unobserve(element);
        observed.delete(element);
      }
    }
    for (const element of nextObserved) {
      if (!observed.has(element)) {
        resizeObserver?.observe(element);
        observed.add(element);
      }
    }
    const state = analyzeAdditionalMenuOverflow(root, adapter);
    if (!state.hasMoreBelow) {
      hint?.remove();
      hint = null;
      return;
    }
    const element = ensureHint();
    const copy = element.querySelector<HTMLElement>(".a11y-additional-menu-copy");
    const message = DEFAULT_ADDITIONAL_MENU_MESSAGE;
    if (copy && copy.textContent !== message) copy.textContent = message;
    place(element);
  }

  const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
    const changedOutsideHint = records.some((record) => {
      if (hint && (record.target === hint || hint.contains(record.target))) return false;
      if (record.type !== "childList" || !hint) return true;
      const changed = [...record.addedNodes, ...record.removedNodes];
      return changed.some((node) => node !== hint && !(node instanceof Element && hint?.contains(node)));
    });
    if (changedOutsideHint) refresh();
  });
  mutationObserver?.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"],
  });
  root.addEventListener("scroll", refresh, true);
  window.addEventListener("scroll", refresh, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  refresh();

  return {
    refresh,
    clear() {
      hint?.remove();
      hint = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observed.clear();
      root.removeEventListener("scroll", refresh, true);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      hint?.remove();
      hint = null;
    },
  };
}
