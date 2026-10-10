import { inspectKioskLayout } from "./diagnostics.js";
const TEXT_SCALE = { standard: 1, large: 1.25, extraLarge: 1.5 };
const CONTROL_SCALE = { standard: 1, large: 1.15 };
function supported() {
    return typeof window !== "undefined" && typeof window.getComputedStyle === "function";
}
function px(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export function createLayoutEnhancer(root, adapter, getProfile) {
    const originals = new Map();
    const baseSizes = new WeakMap();
    let destroyed = false;
    let lastResults = [];
    let resizeFrame = 0;
    let lastViewportWidth = window.innerWidth;
    let lastViewportHeight = window.innerHeight;
    let lastRootWidth = root.clientWidth;
    function remember(element, property) {
        let baseline = originals.get(element);
        if (!baseline) {
            baseline = new Map();
            originals.set(element, baseline);
        }
        if (!baseline.has(property)) {
            baseline.set(property, {
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property),
            });
        }
    }
    function write(element, property, value) {
        remember(element, property);
        element.style.setProperty(property, value, "important");
    }
    function restoreElement(element, forgetBaseline = false) {
        const entries = originals.get(element);
        if (entries) {
            for (const [property, entry] of entries) {
                if (entry.value)
                    element.style.setProperty(property, entry.value, entry.priority);
                else
                    element.style.removeProperty(property);
            }
            originals.delete(element);
        }
        if (forgetBaseline)
            baseSizes.delete(element);
    }
    function captureBaseline(element) {
        if (baseSizes.has(element) || !supported())
            return;
        const toggled = ["a11y-text-large", "a11y-text-extra", "a11y-controls-large"]
            .filter((name) => root.classList.contains(name));
        for (const name of toggled)
            root.classList.remove(name);
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        baseSizes.set(element, {
            font: px(style.fontSize),
            height: rect.height,
            paddingTop: px(style.paddingTop),
            paddingBottom: px(style.paddingBottom),
        });
        for (const name of toggled)
            root.classList.add(name);
    }
    function currentTargets() {
        const set = new Set();
        for (const { element } of adapter.getTextTargets())
            if (root.contains(element))
                set.add(element);
        for (const { element } of adapter.getActions())
            if (root.contains(element))
                set.add(element);
        return [...set];
    }
    function refreshProfile() {
        if (destroyed || !supported())
            return;
        const targets = currentTargets();
        const live = new Set(targets);
        for (const element of [...originals.keys()]) {
            if (!live.has(element))
                restoreElement(element, true);
            else
                restoreElement(element);
        }
        const profile = getProfile();
        const textScale = TEXT_SCALE[profile.textSize];
        const controlScale = CONTROL_SCALE[profile.buttonSize];
        for (const element of targets) {
            captureBaseline(element);
            const style = window.getComputedStyle(element);
            const size = baseSizes.get(element);
            if (textScale > 1 && size.font > 0) {
                write(element, "font-size", `${size.font * textScale}px`);
                if (style.lineHeight !== "normal" && px(style.lineHeight) > 0) {
                    write(element, "line-height", `${Math.max(px(style.lineHeight) * textScale, size.font * textScale * 1.2)}px`);
                }
                write(element, "max-width", "100%");
            }
        }
        if (controlScale > 1) {
            for (const { element } of adapter.getActions()) {
                if (!root.contains(element))
                    continue;
                const size = baseSizes.get(element);
                if (!size)
                    continue;
                write(element, "box-sizing", "border-box");
                write(element, "height", "auto");
                write(element, "min-height", `${Math.max(48, size.height * controlScale)}px`);
                write(element, "padding-top", `${Math.max(8, size.paddingTop * controlScale)}px`);
                write(element, "padding-bottom", `${Math.max(8, size.paddingBottom * controlScale)}px`);
                write(element, "white-space", "normal");
                write(element, "overflow-wrap", "anywhere");
            }
        }
    }
    function tryCorrection(strategy, elements, changes, relevant) {
        const before = inspectKioskLayout(root, adapter);
        const beforeCount = before.filter(relevant).length;
        if (beforeCount === 0 || elements.length === 0) {
            return { strategy, outcome: "not-needed", issuesBefore: beforeCount, issuesAfter: beforeCount };
        }
        const snapshot = new Map();
        for (const element of elements) {
            const properties = new Map();
            snapshot.set(element, properties);
            for (const property of ["white-space", "overflow-wrap", "height", "min-height", "min-width", "max-width", "grid-template-columns", "padding-bottom", "display", "flex-direction", "align-items", "gap"]) {
                properties.set(property, {
                    value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property),
                });
            }
            changes(element);
        }
        const afterIssues = inspectKioskLayout(root, adapter);
        const afterCount = afterIssues.filter(relevant).length;
        const introducedIssue = afterIssues.some((issue) => !before.some((previous) => previous.issueType === issue.issueType &&
            previous.semanticId === issue.semanticId &&
            previous.relatedSemanticId === issue.relatedSemanticId));
        if (afterCount < beforeCount && !introducedIssue) {
            return { strategy, outcome: "applied", issuesBefore: beforeCount, issuesAfter: afterCount };
        }
        for (const [element, properties] of snapshot) {
            for (const [property, value] of properties) {
                if (value.value)
                    element.style.setProperty(property, value.value, value.priority);
                else
                    element.style.removeProperty(property);
            }
        }
        return { strategy, outcome: "reverted", issuesBefore: beforeCount, issuesAfter: afterCount };
    }
    function correctLayout() {
        if (!supported())
            return [];
        const issues = inspectKioskLayout(root, adapter);
        const results = [];
        const regions = adapter.getLayoutRegions();
        const clippedIds = new Set(issues.filter((issue) => issue.issueType === "text-clipped").map((issue) => issue.semanticId));
        if (clippedIds.size) {
            const targets = adapter.getTextTargets().filter((target) => clippedIds.has(target.id)).map(({ element }) => element);
            results.push(tryCorrection("text-wrap", targets, (element) => {
                write(element, "white-space", "normal");
                write(element, "overflow-wrap", "anywhere");
                write(element, "height", "auto");
                write(element, "min-height", "0");
            }, (issue) => issue.issueType === "text-clipped"));
        }
        if (issues.some((issue) => issue.issueType === "horizontal-overflow" || issue.issueType === "action-overlap")) {
            results.push(tryCorrection("release-container-width", regions.reflowContainers ?? [], (element) => {
                write(element, "min-width", "0");
                write(element, "max-width", "100%");
            }, (issue) => issue.issueType === "horizontal-overflow"));
            results.push(tryCorrection("reduce-grid-columns", regions.gridContainers ?? [], (element) => {
                if (window.getComputedStyle(element).display === "grid") {
                    write(element, "grid-template-columns", "minmax(0, 1fr)");
                }
            }, (issue) => issue.issueType === "horizontal-overflow" || issue.issueType === "action-overlap"));
            if (issues.some((issue) => issue.issueType === "action-overlap")) {
                results.push(tryCorrection("stack-action-group", regions.actionGroups ?? [], (element) => {
                    write(element, "display", "flex");
                    write(element, "flex-direction", "column");
                    write(element, "align-items", "stretch");
                    write(element, "gap", "8px");
                }, (issue) => issue.issueType === "action-overlap"));
            }
        }
        if (issues.some((issue) => issue.issueType === "bottom-control-obscures-action" ||
            issue.issueType === "last-scroll-action-obscured") && regions.scrollArea) {
            const area = regions.scrollArea;
            const areaRect = area.getBoundingClientRect();
            const safeInset = (regions.bottomControls ?? []).reduce((max, control) => {
                const rect = control.getBoundingClientRect();
                const top = Math.max(areaRect.top, rect.top);
                const bottom = Math.min(areaRect.bottom, rect.bottom);
                return Math.max(max, bottom - top);
            }, 0);
            const lastActionExtra = issues
                .filter((issue) => issue.issueType === "last-scroll-action-obscured")
                .reduce((max, issue) => {
                const blocked = Number(issue.measurements.predictedBottom) - Number(issue.measurements.safeBottom);
                return Math.max(max, Number.isFinite(blocked) ? blocked + 8 : 0);
            }, 0);
            const overflowY = window.getComputedStyle(area).overflowY;
            if (overflowY === "hidden" || overflowY === "clip" || typeof area.scrollTo !== "function") {
                results.push({
                    strategy: "reserve-scroll-space",
                    outcome: "failed",
                    issuesBefore: 1,
                    issuesAfter: 1,
                    reason: "scroll-unavailable",
                });
            }
            else if (safeInset <= 0) {
                results.push({
                    strategy: "reserve-scroll-space",
                    outcome: "failed",
                    issuesBefore: 1,
                    issuesAfter: 1,
                    reason: "no-safe-inset",
                });
            }
            else {
                results.push(tryCorrection("reserve-scroll-space", [area], (element) => {
                    const existing = px(window.getComputedStyle(element).paddingBottom);
                    write(element, "padding-bottom", `${existing + Math.max(safeInset, lastActionExtra)}px`);
                }, (issue) => issue.issueType === "last-scroll-action-obscured" || issue.issueType === "bottom-control-obscures-action"));
            }
        }
        lastResults = results;
        return [...lastResults];
    }
    function restore() {
        for (const element of [...new Set([...originals.keys(), ...currentTargets()])]) {
            restoreElement(element, true);
        }
    }
    const observer = typeof MutationObserver !== "undefined" && typeof root.nodeType === "number"
        ? new MutationObserver(() => {
            refreshProfile();
            const profile = getProfile();
            if (profile.textSize !== "standard" || profile.buttonSize === "large" || profile.bottomControls) {
                correctLayout();
            }
        })
        : null;
    observer?.observe(root, { childList: true, subtree: true });
    function scheduleResizeRefresh() {
        if (destroyed || resizeFrame)
            return;
        resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = 0;
            const width = window.innerWidth;
            const height = window.innerHeight;
            const rootWidth = root.clientWidth;
            if (width === lastViewportWidth && height === lastViewportHeight && rootWidth === lastRootWidth)
                return;
            lastViewportWidth = width;
            lastViewportHeight = height;
            restore();
            refreshProfile();
            if (getProfile().textSize !== "standard" || getProfile().buttonSize === "large" || getProfile().bottomControls) {
                correctLayout();
            }
            lastRootWidth = root.clientWidth;
        });
    }
    window.addEventListener("resize", scheduleResizeRefresh, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
        if (root.clientWidth !== lastRootWidth)
            scheduleResizeRefresh();
    });
    resizeObserver?.observe(root);
    if (supported()) {
        for (const element of currentTargets())
            captureBaseline(element);
    }
    return {
        applyProfile() { refreshProfile(); },
        correctLayout,
        getLastCorrections: () => [...lastResults],
        restore,
        destroy() {
            destroyed = true;
            observer?.disconnect();
            resizeObserver?.disconnect();
            window.removeEventListener("resize", scheduleResizeRefresh);
            if (resizeFrame)
                window.cancelAnimationFrame(resizeFrame);
            restore();
        },
    };
}
//# sourceMappingURL=layout-enhancements.js.map