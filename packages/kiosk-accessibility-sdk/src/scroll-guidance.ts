import type { AccessibilityAdapter, KioskLayoutRegions } from "./adapter.ts";
export const DEFAULT_PRIMARY_ACTION_MESSAGE =
  "아래에도 버튼이 있어요";
export const DEFAULT_CONTENT_SCROLL_MESSAGE =
  "아래에도 내용이 있어요";

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
  const fixedToViewport = getComputedStyle(el).position === "fixed" &&
    (root === document.body || root === document.documentElement);
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (fixedToViewport && p === root) break;
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
  const doc = document.scrollingElement ?? document.documentElement;
  const isDocumentElement = (element: HTMLElement) =>
    element === document.body || element === document.documentElement || element === doc;
  if (area && root.contains(area) && canScroll(area)) return isDocumentElement(area) ? document : area;
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (isDocumentElement(element)) continue;
    if (canScroll(element)) return element;
  }
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

function viewportAnchored(element: HTMLElement): boolean {
  const position = getComputedStyle(element).position;
  return position === "fixed" || position === "sticky";
}

function visibleObstacle(element: HTMLElement, root: HTMLElement): boolean {
  if (!shown(element)) return false;
  if (getComputedStyle(element).position === "fixed") {
    const rect = element.getBoundingClientRect();
    const width = document.documentElement.clientWidth || innerWidth;
    const height = document.documentElement.clientHeight || innerHeight;
    return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
  }
  return inVisibleViewport(element, root);
}

function getGuidanceObstacles(
  root: HTMLElement,
  regions: KioskLayoutRegions,
  hint: HTMLElement,
): HTMLElement[] {
  const anchoredActions = (regions.primaryActions ?? [])
    .map(({ element }) => element)
    .filter(viewportAnchored);
  const anchoredControls = (regions.bottomControls ?? []).filter(viewportAnchored);
  const qrDocks = typeof document !== "undefined"
    ? Array.from(document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]"))
    : [];
  return [
    ...(regions.viewportOverlays ?? []),
    ...(regions.guidanceAvoidAreas ?? []),
    ...qrDocks,
    ...anchoredActions,
    ...anchoredControls,
    ...(typeof root.querySelectorAll === "function"
      ? Array.from(root.querySelectorAll<HTMLElement>(".a11y-guide-toast"))
      : []),
  ].filter((element) => element !== hint && visibleObstacle(element, root));
}

function currentHint(root: HTMLElement, adapter: AccessibilityAdapter): Hint | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const regions = adapter.getLayoutRegions();
  const smartGuideVisible = typeof root.querySelectorAll === "function" &&
    [...root.querySelectorAll(".a11y-guide-toast")].some((element) =>
        element instanceof HTMLElement && shown(element)
    );
  if ((regions.viewportOverlays ?? []).some(shown) || smartGuideVisible) return null;
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
      return { kind: "primary", message: DEFAULT_PRIMARY_ACTION_MESSAGE };
    }
  }

  if (ownerCanScrollBelow(owner)) {
    return {
      kind: "vertical",
      message: DEFAULT_CONTENT_SCROLL_MESSAGE,
    };
  }
  return null;
}

function placeHint(
  hint: HTMLElement,
  root: HTMLElement,
  regions: KioskLayoutRegions,
): boolean {
  if (root.classList.contains("a11y-bottom-viewport-enabled") ||
      root.classList.contains("a11y-bottom-viewport-poc-shell")) {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const activeArea = regions.scrollArea && root.contains(regions.scrollArea)
      ? regions.scrollArea
      : root;
    const rootRect = activeArea.getBoundingClientRect();
    const width = Math.min(360, vw - 24);
    hint.style.width = "max-content";
    hint.style.maxWidth = `${width}px`;
    hint.style.left = `${Math.max(12, (vw - width) / 2)}px`;
    hint.style.top = "0px";
    hint.style.bottom = "auto";
    hint.style.visibility = "hidden";
    const rect = hint.getBoundingClientRect();
    const left = Math.max(12, (vw - rect.width) / 2);
    hint.style.left = `${left}px`;
    const controls = (regions.bottomControls ?? []).filter((el) =>
      viewportAnchored(el) && visibleObstacle(el, root),
    );
    const lowerEdge = controls.reduce((edge, el) =>
      Math.min(edge, el.getBoundingClientRect().top), Math.min(vh, rootRect.bottom)) - 8;
    const upperEdge = Math.max(0, rootRect.top) + 8;
    const top = lowerEdge - rect.height;
    if (top < upperEdge || rect.height <= 0) {
      if (root.dataset) root.dataset.a11yScrollGuidance = "no-safe-space";
      hint.style.visibility = "hidden";
      return false;
    }
    const obstacles = getGuidanceObstacles(root, regions, hint);
    const candidate = new DOMRect(left, top, rect.width, rect.height);
    const blocked = obstacles.some((el) => {
      const obstacle = el.getBoundingClientRect();
      return candidate.left < obstacle.right && candidate.right > obstacle.left &&
        candidate.top < obstacle.bottom && candidate.bottom > obstacle.top;
    });
    if (blocked) {
      if (root.dataset) root.dataset.a11yScrollGuidance = "no-safe-space";
      hint.style.visibility = "hidden";
      return false;
    }
    hint.style.top = `${top}px`;
    hint.style.visibility = "visible";
    return true;
  }
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  const width = Math.max(0, Math.min(360, vw - 24));
  hint.style.width = `${width}px`;
  hint.style.left = `${Math.max(12, (vw - width) / 2)}px`;
  hint.style.top = "0px";
  hint.style.visibility = "hidden";
  const height = hint.getBoundingClientRect().height;
  const obstacles = getGuidanceObstacles(root, regions, hint);
  const bottomControls = (regions.bottomControls ?? []).filter((element) =>
    viewportAnchored(element) && visibleObstacle(element, root),
  );
  const bottomDockAndControls = [
    ...bottomControls,
    ...obstacles.filter((element) => element.hasAttribute("data-a11y-qr-entry-dock")),
  ];
  const safeBottom = bottomDockAndControls.reduce((top, el) => {
    const r = el.getBoundingClientRect();
    return r.top < vh && r.bottom > 0 ? Math.min(top, r.top) : top;
  }, vh - 12) - 8;
  const positions = [...new Set([
    safeBottom - height,
    vh - height - 12,
    ...obstacles.map((element) => element.getBoundingClientRect().top - height - 8),
  ])].filter((top) => top >= 12).sort((a, b) => b - a);
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
    if (typeof document === "undefined") return null;
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
      if (node) {
        node.setAttribute("aria-hidden", "true");
        node.style.visibility = "hidden";
      }
      return;
    }
    const hint = currentHint(root, adapter);
    if (!hint) {
      if (node) {
        node.setAttribute("aria-hidden", "true");
        node.style.visibility = "hidden";
      }
      if (root.dataset) delete root.dataset.a11yScrollGuidance;
      return;
    }
    const element = ensureNode();
    if (!element) return;
    element.removeAttribute("aria-hidden");
    const copy = element.querySelector<HTMLElement>(".a11y-additional-menu-copy");
    if (copy && copy.textContent !== hint.message) copy.textContent = hint.message;
    if (placeHint(element, root, adapter.getLayoutRegions())) {
      element.dataset.hintKind = hint.kind;
      if (root.dataset) delete root.dataset.a11yScrollGuidance;
    } else {
      element.setAttribute("aria-hidden", "true");
      element.style.visibility = "hidden";
    }
  };
  const schedule = () => {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  };
  const onScroll = () => refresh();
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
    const relevant = records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".a11y-additional-menu-hint, .a11y-guide-toast, .a11y-guidance-slot, .a11y-qr-entry-dock")) return false;
      if (record.type === "childList") {
        const changed = [...record.addedNodes, ...record.removedNodes];
        if (changed.length && changed.every((item) =>
          item instanceof Element && item.matches(".a11y-additional-menu-hint, .a11y-guide-toast, .a11y-guidance-slot, .a11y-qr-entry-dock"),
        )) return false;
      }
      return true;
    });
    if (relevant) schedule();
  });
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
