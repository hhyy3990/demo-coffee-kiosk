import type { AccessibilityAdapter, KioskLayoutRegions } from "./adapter.ts";
import { analyzeAdditionalMenuOverflow } from "./menu-overflow.ts";

export const DEFAULT_HORIZONTAL_LIST_MESSAGE =
  "오른쪽에도 항목이 있습니다. 왼쪽으로 밀어보세요.";
export const DEFAULT_PRIMARY_ACTION_MESSAGE =
  "아래에 다음 버튼이 있습니다. 화면을 위로 밀어보세요.";

type Hint = { kind: string; message: string };

function shown(el: HTMLElement): boolean {
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return el.isConnected && s.display !== "none" && s.visibility !== "hidden" &&
    Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
}

function inVisibleViewport(el: HTMLElement, root: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  let left = 0, top = 0, right = document.documentElement.clientWidth || innerWidth;
  let bottom = document.documentElement.clientHeight || innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p), pr = p.getBoundingClientRect();
    if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) {
      left = Math.max(left, pr.left + p.clientLeft);
      right = Math.min(right, pr.left + p.clientLeft + p.clientWidth);
    }
    if (["auto", "scroll", "hidden", "clip"].includes(s.overflowY)) {
      top = Math.max(top, pr.top + p.clientTop);
      bottom = Math.min(bottom, pr.top + p.clientTop + p.clientHeight);
    }
    if (p === root) break;
  }
  return r.right > left && r.left < right && r.bottom > top && r.top < bottom;
}

function verticalOwner(el: HTMLElement, root: HTMLElement, area?: HTMLElement | null): HTMLElement | Document | null {
  if (area && root.contains(area) && area.scrollHeight > area.clientHeight + 1 &&
      ["auto", "scroll", "overlay"].includes(getComputedStyle(area).overflowY)) return area;
  for (let p = el.parentElement; p && root.contains(p); p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1 &&
        ["auto", "scroll", "overlay"].includes(getComputedStyle(p).overflowY)) return p;
  }
  const doc = document.scrollingElement ?? document.documentElement;
  return doc.scrollHeight > doc.clientHeight + 1 ? document : null;
}

function belowCanScroll(owner: HTMLElement | Document | null): boolean {
  if (!owner) return false;
  return owner instanceof Document
    ? window.scrollY < owner.documentElement.scrollHeight - owner.documentElement.clientHeight - 1
    : owner.scrollTop < owner.scrollHeight - owner.clientHeight - 1;
}

function currentHint(root: HTMLElement, adapter: AccessibilityAdapter): Hint | null {
  const regions = adapter.getLayoutRegions();
  const actions = regions.primaryActions ?? [];
  for (const candidate of actions) {
    const el = candidate.element;
    if (!root.contains(el) || !shown(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > (document.documentElement.clientHeight || innerHeight) + 1 &&
        belowCanScroll(verticalOwner(el, root, regions.scrollArea))) {
      return { kind: "primary", message: candidate.message || DEFAULT_PRIMARY_ACTION_MESSAGE };
    }
  }

  for (const list of regions.horizontalLists ?? []) {
    const container = list.container;
    if (!root.contains(container) || !shown(container) ||
        !["auto", "scroll", "overlay"].includes(getComputedStyle(container).overflowX) ||
        container.scrollWidth <= container.clientWidth + 1) continue;
    const r = container.getBoundingClientRect();
    const visibleItems = list.items.filter((item) => root.contains(item) && shown(item));
    const direction = list.direction ?? getComputedStyle(container).direction as "ltr" | "rtl";
    const hidden = direction === "rtl"
      ? visibleItems.some((item) => item.getBoundingClientRect().left < r.left + container.clientLeft - 1)
      : visibleItems.some((item) => item.getBoundingClientRect().right > r.left + container.clientLeft + container.clientWidth + 1);
    if (hidden) return {
      kind: "horizontal",
      message: list.message || DEFAULT_HORIZONTAL_LIST_MESSAGE,
    };
  }

  const menu = analyzeAdditionalMenuOverflow(root, adapter);
  if (menu.hasMoreBelow) {
    return {
      kind: "vertical",
      message: regions.menuMessage || "아래에도 항목이 있습니다. 화면을 위로 밀어보세요.",
    };
  }
  return null;
}

function placeHint(
  hint: HTMLElement,
  root: HTMLElement,
  regions: KioskLayoutRegions,
): boolean {
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  const width = Math.max(0, Math.min(360, vw - 24));
  hint.style.width = `${width}px`;
  hint.style.left = `${Math.max(12, (vw - width) / 2)}px`;
  hint.style.top = "0px";
  hint.style.visibility = "hidden";
  const height = hint.getBoundingClientRect().height;
  const obstacles = [
    ...(regions.bottomControls ?? []),
    ...(regions.guidanceAvoidAreas ?? []),
    ...(regions.menuItems ?? []),
    ...adapterActions(root, regions),
    ...Array.from(root.querySelectorAll<HTMLElement>(".a11y-guide-toast")),
  ].filter((el) => {
    if (el === hint || !shown(el)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw &&
      inVisibleViewport(el, root);
  });
  const bottomControls = (regions.bottomControls ?? []).filter(shown);
  const safeBottom = bottomControls.reduce((top, el) => {
    const r = el.getBoundingClientRect();
    return r.top < vh && r.bottom > 0 ? Math.min(top, r.top) : top;
  }, vh - 12);
  const positions = [safeBottom - height, vh - height - 12].filter((v, i, a) => a.indexOf(v) === i);
  for (const top of positions) {
    if (top < 12) continue;
    const candidate = new DOMRect(parseFloat(hint.style.left), top, width, height);
    if (obstacles.some((el) => {
      const r = el.getBoundingClientRect();
      return candidate.left < r.right && candidate.right > r.left &&
        candidate.top < r.bottom && candidate.bottom > r.top;
    })) continue;
    hint.style.top = `${top}px`;
    hint.style.visibility = "visible";
    return true;
  }
  if (root.dataset) root.dataset.a11yScrollGuidance = "no-safe-space";
  hint.style.visibility = "hidden";
  return false;
}

function adapterActions(root: HTMLElement, _regions: KioskLayoutRegions): HTMLElement[] {
  // Existing interactive controls are protected from hint placement by their
  // registered semantics only through the host's optional primary action list.
  return Array.from(root.querySelectorAll<HTMLElement>("button, [role=button], input, select"));
}

export function createScrollGuidance(root: HTMLElement, adapter: AccessibilityAdapter) {
  let node: HTMLElement | null = null;
  let frame = 0;
  let destroyed = false;
  const ensureNode = () => {
    if (node) return node;
    node = document.createElement("aside");
    node.className = "a11y-additional-menu-hint";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.setAttribute("aria-atomic", "true");
    node.innerHTML = '<span aria-hidden="true">↓</span><span class="a11y-additional-menu-copy"></span>';
    root.append(node);
    return node;
  };
  const refresh = () => {
    if (destroyed) return;
    const hint = currentHint(root, adapter);
    if (!hint) {
      node?.remove();
      node = null;
      if (root.dataset) delete root.dataset.a11yScrollGuidance;
      return;
    }
    const element = ensureNode();
    const copy = element.querySelector<HTMLElement>(".a11y-additional-menu-copy");
    if (copy && copy.textContent !== hint.message) copy.textContent = hint.message;
    if (placeHint(element, root, adapter.getLayoutRegions())) {
      element.dataset.hintKind = hint.kind;
      if (root.dataset) delete root.dataset.a11yScrollGuidance;
    } else {
      element.remove();
      node = null;
    }
  };
  const schedule = () => {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  };
  const onScroll = () => refresh();
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(root);
  root.addEventListener("scroll", onScroll, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  refresh();
  return {
    refresh,
    clear() { node?.remove(); node = null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect(); resize?.disconnect();
      root.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      node?.remove(); node = null;
    },
  };
}
