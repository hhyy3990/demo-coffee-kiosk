const HOME_CLASS = "a11y-qr-entry-dock-home";
const BOTTOM_CLASS = "a11y-qr-entry-dock-bottom";
const HEIGHT_VAR = "--a11y-qr-entry-dock-height";
const INSET_VAR = "--a11y-qr-entry-dock-controls-inset";
const CONTENT_VAR = "--a11y-qr-entry-dock-content-height";
const SCROLL_CLASS = "a11y-qr-entry-dock-scroll-area";
const CSS_VARS = [HEIGHT_VAR, INSET_VAR, CONTENT_VAR];
const profileViewportByRoot = new WeakMap();
const dockSyncByRoot = new WeakMap();
/** Internal bridge used by the SDK so a profile change does not recreate a host dock. */
export function syncQrEntryDockViewportMode(root, percent) {
    profileViewportByRoot.set(root, percent);
    for (const sync of dockSyncByRoot.get(root) ?? [])
        sync(percent);
}
/** Creates an SDK-owned QR entry dock whose active state is controlled by the host. */
export function createQrEntryDock(options) {
    const { root, adapter, onOpenQr, label = "내 QR로 화면 설정", theme } = options;
    const configuredDevelopmentPercent = options.bottomViewportPercent;
    let profilePercent = profileViewportByRoot.get(root) ?? null;
    let effectivePercent = configuredDevelopmentPercent ?? profilePercent;
    const rootClassState = new Map();
    const previousVars = new Map();
    let footer = null;
    let button = null;
    let scrollArea = null;
    let scrollAreaHadClass = false;
    let active = false;
    let destroyed = false;
    for (const className of [HOME_CLASS, BOTTOM_CLASS]) {
        rootClassState.set(className, root.classList.contains(className));
    }
    for (const name of CSS_VARS) {
        previousVars.set(name, {
            value: root.style.getPropertyValue(name),
            priority: root.style.getPropertyPriority(name),
        });
    }
    const restoreRoot = () => {
        if (scrollArea && !scrollAreaHadClass)
            scrollArea.classList.remove(SCROLL_CLASS);
        scrollArea = null;
        for (const [name, state] of previousVars) {
            if (state.value)
                root.style.setProperty(name, state.value, state.priority);
            else
                root.style.removeProperty(name);
        }
        for (const [className, existed] of rootClassState) {
            root.classList.toggle(className, existed);
        }
    };
    const destroyDock = () => {
        if (!active)
            return;
        active = false;
        observer?.disconnect();
        resizeObserver?.disconnect();
        window.removeEventListener("resize", updateMeasurements);
        button?.removeEventListener("click", onOpenQr);
        footer?.remove();
        footer = null;
        button = null;
        restoreRoot();
    };
    const updateMeasurements = () => {
        if (!active || !footer)
            return;
        const registeredScrollArea = adapter.getLayoutRegions().scrollArea;
        const nextScrollArea = registeredScrollArea && root.contains(registeredScrollArea) ? registeredScrollArea : root;
        if (nextScrollArea !== scrollArea) {
            if (scrollArea && !scrollAreaHadClass)
                scrollArea.classList.remove(SCROLL_CLASS);
            scrollArea = nextScrollArea;
            scrollAreaHadClass = scrollArea.classList.contains(SCROLL_CLASS);
            scrollArea.classList.add(SCROLL_CLASS);
        }
        const dockHeight = Math.max(64, Math.ceil(footer.getBoundingClientRect().height));
        const controlsInset = Math.ceil((adapter.getLayoutRegions().bottomControls ?? []).reduce((inset, element) => {
            if (!element.isConnected)
                return inset;
            const style = getComputedStyle(element);
            if (style.display === "none" || !["fixed", "sticky"].includes(style.position))
                return inset;
            const rect = element.getBoundingClientRect();
            return rect.bottom >= window.innerHeight - 1 && rect.top < window.innerHeight
                ? Math.max(inset, window.innerHeight - rect.top)
                : inset;
        }, 0));
        root.style.setProperty(HEIGHT_VAR, `${dockHeight}px`);
        root.style.setProperty(INSET_VAR, `${controlsInset}px`);
        footer.style.setProperty(INSET_VAR, `${controlsInset}px`);
        const availableHeight = Math.max(0, window.innerHeight - dockHeight - controlsInset);
        if (effectivePercent)
            root.style.setProperty(CONTENT_VAR, `${Math.floor(availableHeight * effectivePercent / 100)}px`);
        else
            root.style.removeProperty(CONTENT_VAR);
        root.classList.toggle(BOTTOM_CLASS, Boolean(effectivePercent));
        const rootStyle = getComputedStyle(root);
        footer.style.fontFamily = rootStyle.fontFamily;
        footer.style.fontSize = rootStyle.fontSize;
        footer.classList.toggle("a11y-qr-entry-dock-contrast", root.classList.contains("a11y-high-contrast"));
    };
    let observer = null;
    let resizeObserver = null;
    function mountDock() {
        if (active || destroyed)
            return;
        active = true;
        footer = document.createElement("aside");
        button = document.createElement("button");
        footer.className = "a11y-qr-entry-dock";
        footer.dataset.a11yQrEntryDock = "true";
        footer.setAttribute("aria-label", "QR 화면 설정");
        button.type = "button";
        button.className = "a11y-qr-entry-dock-button";
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-haspopup", "dialog");
        button.innerHTML = '<svg class="a11y-qr-entry-dock-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM19 19h2v2h-2zM14 19h2v2h-2z"/></svg><span></span>';
        button.querySelector("span").textContent = label;
        button.addEventListener("click", onOpenQr);
        footer.append(button);
        for (const [property, value] of [
            ["--a11y-qr-entry-dock-surface", theme?.surface],
            ["--a11y-qr-entry-dock-foreground", theme?.foreground],
            ["--a11y-qr-entry-dock-button", theme?.button],
            ["--a11y-qr-entry-dock-button-foreground", theme?.buttonForeground],
        ]) {
            if (value)
                footer.style.setProperty(property, value);
        }
        document.body.append(footer);
        root.classList.add(HOME_CLASS);
        if (effectivePercent)
            root.classList.add(BOTTOM_CLASS);
        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMeasurements);
        resizeObserver?.observe(footer);
        observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(updateMeasurements);
        observer?.observe(root, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
        window.addEventListener("resize", updateMeasurements, { passive: true });
        updateMeasurements();
    }
    const controller = {
        setActive(value) {
            if (destroyed)
                return;
            if (value)
                mountDock();
            else
                destroyDock();
        },
        destroy() {
            if (destroyed)
                return;
            destroyDock();
            destroyed = true;
            restoreRoot();
        },
    };
    const sync = (percent) => {
        profilePercent = percent;
        effectivePercent = configuredDevelopmentPercent ?? profilePercent;
        if (active)
            updateMeasurements();
    };
    let syncs = dockSyncByRoot.get(root);
    if (!syncs) {
        syncs = new Set();
        dockSyncByRoot.set(root, syncs);
    }
    syncs.add(sync);
    const originalDestroy = controller.destroy.bind(controller);
    controller.destroy = () => {
        syncs?.delete(sync);
        if (syncs?.size === 0)
            dockSyncByRoot.delete(root);
        originalDestroy();
    };
    controller.setActive(options.active);
    return controller;
}
//# sourceMappingURL=qr-entry-dock.js.map