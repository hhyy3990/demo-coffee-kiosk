import type { AccessibilityAdapter, KioskLayoutRegions } from "./adapter.ts";
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

function findVerticalOwner(root: HTMLElement, area?: HTMLElement | null): HTMLElement | Document | null {
  const canScroll = (element: HTMLElement) =>
    element.scrollHeight > element.clientHeight + 1 &&
    ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY);
  if (area && root.contains(area) && canScroll(area)) return area;
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (canScroll(element)) return element;
  }
  const doc = document.scrollingElement ?? document.documentElement;
  const permitted = (value: string) => value !== "hidden" && value !== "clip";
  if (permitted(getComputedStyle(document.documentElement).overflowY) &&
      (!document.body || permitted(getComputedStyle(document.body).overflowY)) &&
      doc.scrollHeight > doc.clientHeight + 1) return document;
  return null;
}

function ownerCanScrollBelow(owner: HTMLElement | Document | null): boolean {
  if (!owner) return false;
  return owner instanceof Document
    ? (owner.scrollingElement ?? owner.documentElement).scrollTop <
      (owner.scrollingElement ?? owner.documentElement).scrollHeight -
      (owner.scrollingElement ?? owner.documentElement).clientHeight - 1
    : owner.scrollTop < owner.scrollHeight - owner.clientHeight - 1;
}

function currentHint(root: HTMLElement, adapter: AccessibilityAdapter): Hint | null {
  const regions = adapter.getLayoutRegions();
  const owner = typeof root.querySelectorAll === "function"
    ? findVerticalOwner(root, regions.scrollArea)
    : null;
  const actions = regions.primaryActions ?? [];
  for (const candidate of actions) {
    const el = candidate.element;
    if (!root.contains(el) || !shown(el)) continue;
    const rect = el.getBoundingClientRect();
    const lowerEdge = owner instanceof Document
      ? (document.documentElement.clientHeight || innerHeight)
      : owner
        ? owner.getBoundingClientRect().top + owner.clientTop + owner.clientHeight
        : (document.documentElement.clientHeight || innerHeight);
    if (rect.bottom > lowerEdge + 1 &&
        ownerCanScrollBelow(owner)) {
      return { kind: "primary", message: candidate.message || DEFAULT_PRIMARY_ACTION_MESSAGE };
    }
  }

  if (ownerCanScrollBelow(owner)) {
    return {
      kind: "vertical",
      message: regions.menuMessage || "아래에도 내용이 있습니다. 화면을 위로 밀어보세요.",
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
    ...(typeof root.querySelectorAll === "function"
      ? Array.from(root.querySelectorAll<HTMLElement>(".a11y-guide-toast"))
      : []),
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

export function createScrollGuidance(root: HTMLElement, adapter: AccessibilityAdapter) {
  let node: HTMLElement | null = null;
  let frame = 0;
  let destroyed = false;
  let enabled = true;
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
    if (!enabled) {
      node?.remove();
      node = null;
      return;
    }
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
    setEnabled(value: boolean) {
      enabled = value;
      if (enabled) refresh();
      else { node?.remove(); node = null; }
    },
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
