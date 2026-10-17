export const DEFAULT_PRIMARY_ACTION_MESSAGE = "아래에도 버튼이 있어요";
export const DEFAULT_CONTENT_SCROLL_MESSAGE = "아래에도 내용이 있어요";
function shown(el) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return el.isConnected && s.display !== "none" && s.visibility !== "hidden" &&
        Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
}
function fixedBottomObstacle(controls, owner) {
    const viewportHeight = document.documentElement.clientHeight || innerHeight;
    const ownerBottom = owner instanceof Document
        ? viewportHeight
        : (() => {
            const rect = owner.getBoundingClientRect();
            const scaleY = owner.offsetHeight > 0 ? rect.height / owner.offsetHeight : 1;
            return rect.top + (owner.clientTop + owner.clientHeight) * scaleY;
        })();
    return controls?.filter((element) => {
        if (!shown(element))
            return false;
        const position = getComputedStyle(element).position;
        if (position !== "fixed" && position !== "sticky")
            return false;
        const rect = element.getBoundingClientRect();
        return rect.top < ownerBottom && rect.bottom > 0 && rect.top < viewportHeight;
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
}
function findVerticalOwner(root, area, allowDocumentFallback = true) {
    const canScroll = (element) => element.scrollHeight > element.clientHeight + 1 &&
        ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY);
    const doc = document.scrollingElement ?? document.documentElement;
    const isDocumentElement = (element) => element === document.body || element === document.documentElement || element === doc;
    if (area && root.contains(area) && canScroll(area))
        return isDocumentElement(area) ? document : area;
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (isDocumentElement(element))
            continue;
        if (canScroll(element))
            return element;
    }
    if (!allowDocumentFallback)
        return null;
    const permitted = (value) => value !== "hidden" && value !== "clip";
    if (permitted(getComputedStyle(document.documentElement).overflowY) &&
        (!document.body || permitted(getComputedStyle(document.body).overflowY)) &&
        doc.scrollHeight > doc.clientHeight + 1)
        return document;
    return null;
}
function ownerCanScrollBelow(owner) {
    if (!owner)
        return false;
    return owner instanceof Document
        ? (owner.scrollingElement ?? owner.documentElement).scrollTop <
            (owner.scrollingElement ?? owner.documentElement).scrollHeight -
                (owner.scrollingElement ?? owner.documentElement).clientHeight - 1
        : owner.scrollTop < owner.scrollHeight - owner.clientHeight - 1;
}
function findDeepestVerticalOwner(root) {
    const scrollable = [root, ...Array.from(root.querySelectorAll("*"))]
        .filter((element) => element.scrollHeight > element.clientHeight + 1 &&
        ["auto", "scroll", "overlay"].includes(getComputedStyle(element).overflowY));
    const depth = (element) => {
        let value = 0;
        for (let current = element; current && current !== root; current = current.parentElement) {
            value += 1;
        }
        return value;
    };
    return scrollable.sort((a, b) => depth(b) - depth(a))[0] ?? null;
}
function currentHint(root, adapter) {
    if (typeof document === "undefined" || typeof window === "undefined")
        return null;
    const regions = adapter.getLayoutRegions();
    const activeOverlay = (regions.viewportOverlays ?? []).filter(shown)
        .map((element, order) => ({ element, order, zIndex: Number.parseInt(getComputedStyle(element).zIndex, 10) || 0 }))
        .sort((a, b) => a.zIndex - b.zIndex || a.order - b.order)
        .at(-1)?.element;
    if (activeOverlay) {
        const owner = findDeepestVerticalOwner(activeOverlay);
        if (!owner || !ownerCanScrollBelow(owner))
            return null;
        return { kind: "vertical", message: DEFAULT_CONTENT_SCROLL_MESSAGE, owner };
    }
    const owner = typeof root.querySelectorAll === "function"
        ? findVerticalOwner(root, regions.scrollArea)
        : null;
    const effectiveOwner = owner ?? root;
    const obstacle = fixedBottomObstacle(regions.bottomControls, effectiveOwner);
    const actions = regions.primaryActions ?? [];
    for (const candidate of activeOverlay ? [] : actions) {
        const el = candidate.element;
        if (!root.contains(el) || !shown(el))
            continue;
        const rect = el.getBoundingClientRect();
        const lowerEdge = owner instanceof Document
            ? (document.documentElement.clientHeight || innerHeight)
            : owner
                ? owner.getBoundingClientRect().top + owner.clientTop + owner.clientHeight
                : (document.documentElement.clientHeight || innerHeight);
        if (rect.bottom > lowerEdge + 1 &&
            ownerCanScrollBelow(owner)) {
            const slotObstacle = root.querySelector('[data-a11y-slot="above-bottom-controls"]');
            return { kind: "primary", message: DEFAULT_PRIMARY_ACTION_MESSAGE, owner: effectiveOwner,
                ...(obstacle ? { obstacle } : {}),
                ...(!obstacle && slotObstacle && shown(slotObstacle) ? { obstacle: slotObstacle } : {}) };
        }
    }
    if (ownerCanScrollBelow(owner)) {
        const slotObstacle = root.querySelector('[data-a11y-slot="above-bottom-controls"]');
        return {
            kind: "vertical",
            message: DEFAULT_CONTENT_SCROLL_MESSAGE,
            owner: effectiveOwner,
            ...(obstacle ? { obstacle } : {}),
            ...(!obstacle && slotObstacle && shown(slotObstacle) ? { obstacle: slotObstacle } : {}),
        };
    }
    return null;
}
function placeHint(hint, owner, obstacle) {
    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width || document.documentElement.clientWidth || innerWidth;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportBottom = viewportTop + (visualViewport?.height || innerHeight);
    const vw = viewportWidth;
    const width = Math.max(0, Math.min(360, vw - 24));
    hint.style.position = "fixed";
    hint.style.zIndex = "2147483000";
    hint.style.width = "max-content";
    hint.style.maxWidth = `${width}px`;
    hint.style.left = `${viewportLeft + 12}px`;
    hint.style.top = "auto";
    let ownerBottom = viewportBottom;
    if (!(owner instanceof Document)) {
        const rect = owner.getBoundingClientRect();
        const scaleY = owner.offsetHeight > 0 ? rect.height / owner.offsetHeight : 1;
        ownerBottom = rect.top + (owner.clientTop + owner.clientHeight) * scaleY;
    }
    const anchorBottom = Math.min(viewportBottom, ownerBottom);
    if (anchorBottom <= viewportTop)
        return false;
    let bottomInset = Math.max(12, viewportBottom - anchorBottom + 12);
    if (obstacle && shown(obstacle)) {
        const obstacleTop = obstacle.getBoundingClientRect().top;
        bottomInset = Math.max(bottomInset, viewportBottom - obstacleTop + 12);
    }
    hint.style.bottom = `${bottomInset}px`;
    hint.style.pointerEvents = "none";
    hint.style.visibility = "visible";
    const height = hint.getBoundingClientRect().height;
    const rect = hint.getBoundingClientRect();
    hint.style.left = `${Math.max(viewportLeft + 12, viewportLeft + (vw - rect.width) / 2)}px`;
    return height > 0;
}
export function createScrollGuidance(root, adapter) {
    let node = null;
    let frame = 0;
    let destroyed = false;
    let enabled = true;
    const ensureNode = () => {
        if (node)
            return node;
        if (typeof document === "undefined")
            return null;
        node = document.createElement("aside");
        node.className = "a11y-additional-menu-hint";
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        node.setAttribute("aria-atomic", "true");
        node.innerHTML = '<span aria-hidden="true">↓</span><span class="a11y-additional-menu-copy"></span>';
        document.body.append(node);
        return node;
    };
    const syncTheme = (element) => {
        const style = getComputedStyle(root);
        const baseSize = Number.parseFloat(style.fontSize) || 16;
        const enlarged = root.classList.contains("a11y-text-large") ||
            root.classList.contains("a11y-text-extra");
        element.style.fontFamily = style.fontFamily;
        element.style.fontSize = `${baseSize * (enlarged ? 1.12 : 1)}px`;
        element.classList.toggle("a11y-additional-menu-hint-high-contrast", root.classList.contains("a11y-high-contrast"));
    };
    const refresh = () => {
        if (destroyed)
            return;
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
            if (root.dataset)
                delete root.dataset.a11yScrollGuidance;
            return;
        }
        const element = ensureNode();
        if (!element)
            return;
        if (element.parentElement !== document.body)
            document.body.append(element);
        syncTheme(element);
        element.removeAttribute("aria-hidden");
        const copy = element.querySelector(".a11y-additional-menu-copy");
        if (copy && copy.textContent !== hint.message)
            copy.textContent = hint.message;
        if (placeHint(element, hint.owner, hint.obstacle)) {
            element.dataset.hintKind = hint.kind;
            if (root.dataset)
                delete root.dataset.a11yScrollGuidance;
        }
        else {
            element.setAttribute("aria-hidden", "true");
            element.style.visibility = "hidden";
        }
    };
    const schedule = () => {
        if (destroyed || frame)
            return;
        frame = requestAnimationFrame(() => { frame = 0; refresh(); });
    };
    const onScroll = () => refresh();
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
        const relevant = records.some((record) => {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            if (target?.closest(".a11y-additional-menu-hint, .a11y-guide-toast, .a11y-guidance-slot, .a11y-qr-entry-dock"))
                return false;
            if (record.type === "childList") {
                const changed = [...record.addedNodes, ...record.removedNodes];
                if (changed.length && changed.every((item) => item instanceof Element && item.matches(".a11y-additional-menu-hint, .a11y-guide-toast, .a11y-guidance-slot, .a11y-qr-entry-dock")))
                    return false;
            }
            return true;
        });
        if (relevant)
            schedule();
    });
    observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(root);
    root.addEventListener("scroll", onScroll, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule, { passive: true });
    refresh();
    return {
        refresh,
        setEnabled(value) {
            enabled = value;
            if (enabled)
                refresh();
            else {
                node?.remove();
                node = null;
            }
        },
        clear() { node?.remove(); node = null; },
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            observer?.disconnect();
            resize?.disconnect();
            root.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("scroll", schedule);
            window.visualViewport?.removeEventListener("resize", schedule);
            if (frame)
                cancelAnimationFrame(frame);
            node?.remove();
            node = null;
        },
    };
}
//# sourceMappingURL=scroll-guidance.js.map