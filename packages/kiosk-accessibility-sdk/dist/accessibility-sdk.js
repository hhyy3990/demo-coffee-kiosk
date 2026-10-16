import { createBottomViewportController, } from "./bottom-viewport.js";
import { inspectKioskLayout } from "./diagnostics.js";
import { createLayoutEnhancer, } from "./layout-enhancements.js";
import { createScrollGuidance } from "./scroll-guidance.js";
import { createIdleTimer, smartGuideDelayMs } from "./guide.js";
import { ACCESSIBILITY_SDK_VERSION, accessibilityClasses, DEFAULT_ACCESSIBILITY_PROFILE, validateAccessibilityProfile, } from "./profile.js";
import { cancelSpeech, speakText } from "./speech.js";
import { createScreenChangeController } from "./screen-change.js";
import { syncQrEntryDockViewportMode } from "./qr-entry-dock.js";
import { createCompletionController, } from "./completion.js";
const MANAGED_CLASSES = [
    "a11y-text-large",
    "a11y-text-extra",
    "a11y-controls-large",
    "a11y-high-contrast",
    "a11y-easy-language",
    "a11y-bottom-controls",
];
export const GUIDE_AUTO_DISMISS_MS = 10_000;
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
function getVisibleClientRect(element, viewportWidth = document.documentElement?.clientWidth || window.innerWidth, viewportHeight = document.documentElement?.clientHeight || window.innerHeight) {
    const rect = element.getBoundingClientRect();
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(viewportWidth, rect.right);
    let bottom = Math.min(viewportHeight, rect.bottom);
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clipRect = ancestor.getBoundingClientRect();
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX)) {
            left = Math.max(left, clipRect.left);
            right = Math.min(right, clipRect.right);
        }
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY)) {
            top = Math.max(top, clipRect.top);
            bottom = Math.min(bottom, clipRect.bottom);
        }
        if (right <= left || bottom <= top)
            return null;
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null;
}
function getGuideProtectedActions(regions) {
    const markedActions = typeof document.querySelectorAll === "function"
        ? Array.from(document.querySelectorAll('[data-a11y-primary="true"]'))
        : [];
    return [...new Set([
            ...(regions?.primaryActions ?? []).map(({ element }) => element),
            ...markedActions,
        ])];
}
function primaryActionsRemainHitTestable(overlay, regions) {
    const document = overlay.ownerDocument;
    const view = document?.defaultView;
    const hitTest = document?.elementFromPoint?.bind(document);
    if (!view || !hitTest)
        return true;
    const overlayRect = overlay.getBoundingClientRect();
    return getGuideProtectedActions(regions).every((element) => {
        if (!element.isConnected || ("disabled" in element && Boolean(element.disabled)))
            return true;
        if (getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden")
            return true;
        const rect = getVisibleClientRect(element, view.innerWidth, view.innerHeight);
        if (!rect)
            return true;
        const left = Math.max(rect.left, overlayRect.left);
        const right = Math.min(rect.right, overlayRect.right);
        const top = Math.max(rect.top, overlayRect.top);
        const bottom = Math.min(rect.bottom, overlayRect.bottom);
        if (right <= left || bottom <= top)
            return true;
        const x = left + (right - left) / 2;
        const y = top + (bottom - top) / 2;
        const hit = hitTest(x, y);
        return hit === element || element.contains(hit);
    });
}
function positionGuide(overlay, target, root, regions) {
    if (!target || !target.isConnected)
        return false;
    const previousTop = Number.parseFloat(overlay.style.top);
    if (typeof getComputedStyle !== "function") {
        overlay.style.position = "fixed";
        overlay.style.left = `${Number.isFinite(Number.parseFloat(overlay.style.left))
            ? overlay.style.left
            : "12px"}`;
        overlay.style.top = `${Number.isFinite(previousTop) ? previousTop : 12}px`;
        overlay.style.visibility = "visible";
        return true;
    }
    // Placement must be atomic: a transition can temporarily cover a protected
    // host action even when the final position has passed hit testing.
    if (typeof overlay.style.setProperty === "function") {
        overlay.style.setProperty("transition", "none", "important");
    }
    else {
        overlay.style.transition = "none";
    }
    if (root?.classList.contains("a11y-bottom-viewport-enabled") ||
        root?.classList.contains("a11y-bottom-viewport-poc-shell")) {
        const vw = document.documentElement.clientWidth || innerWidth;
        const vh = document.documentElement.clientHeight || innerHeight;
        const scrollArea = regions?.scrollArea && root.contains(regions.scrollArea)
            ? regions.scrollArea
            : null;
        const shell = (scrollArea ?? root).getBoundingClientRect();
        const qrDocks = Array.from(document.querySelectorAll("[data-a11y-qr-entry-dock]"));
        const controls = [...(regions?.bottomControls ?? []), ...qrDocks].filter((el) => el.isConnected && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none");
        const safeBottom = controls.reduce((edge, el) => Math.min(edge, el.getBoundingClientRect().top), Math.min(vh, shell.top)) - 8;
        // Keep the shared guide in the non-scrolling viewport band above the
        // scroll owner; placing it over scrolled content can cover menu actions.
        const safeTop = 8;
        const availableHeight = safeBottom - safeTop;
        if (availableHeight < 72)
            return false;
        overlay.style.position = "fixed";
        overlay.style.left = `${Math.max(12, (vw - Math.min(500, vw - 24)) / 2)}px`;
        overlay.style.top = `${safeTop}px`;
        overlay.style.bottom = "auto";
        overlay.style.width = `min(500px, calc(100vw - 24px))`;
        // Leave a small subpixel tolerance so a panel at the exact safe-area
        // height does not fail placement from fractional font metrics.
        overlay.style.maxHeight = `${Math.max(0, availableHeight - 2)}px`;
        overlay.style.overflowY = "auto";
        overlay.style.visibility = "hidden";
        const height = overlay.getBoundingClientRect().height;
        const action = target.getBoundingClientRect();
        const minimum = safeTop;
        const maximum = safeBottom - height;
        const positions = [action.top - height - 12, action.bottom + 12];
        const isMovingScrollContent = (element) => {
            if (!scrollArea || typeof getComputedStyle !== "function")
                return false;
            const position = getComputedStyle(element).position;
            return scrollArea.contains(element) &&
                position !== "fixed" && position !== "sticky";
        };
        const obstacles = [
            ...(isMovingScrollContent(target) ? [] : [target]),
            ...getGuideProtectedActions(regions).filter((element) => !isMovingScrollContent(element)),
            ...(regions?.viewportOverlays ?? []),
            ...(regions?.guidanceAvoidAreas ?? []).filter((element) => !isMovingScrollContent(element)),
            ...controls,
        ].filter((el) => el !== overlay && el.isConnected &&
            getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" &&
            getVisibleClientRect(el, vw, vh) !== null);
        const obstacleEdges = obstacles.flatMap((element) => {
            const rect = getVisibleClientRect(element, vw, vh);
            return [rect.top - height - 8, rect.bottom + 8]
                .map((candidate) => clamp(candidate, minimum, maximum));
        });
        const fits = positions.map((candidate) => clamp(candidate, minimum, maximum));
        fits.push(minimum, maximum, minimum + (maximum - minimum) / 2);
        const candidates = [...new Set([
                ...(Number.isFinite(previousTop) ? [clamp(previousTop, minimum, maximum)] : []),
                ...fits,
                ...obstacleEdges,
            ].filter(Number.isFinite))];
        const overlapsAt = (candidate, element) => {
            const rect = getVisibleClientRect(element, vw, vh);
            if (!rect)
                return false;
            return 12 < rect.right && vw - 12 > rect.left &&
                candidate < rect.bottom && candidate + height > rect.top;
        };
        const top = candidates.find((candidate) => !obstacles.some((element) => overlapsAt(candidate, element)));
        if (top === undefined || maximum < minimum)
            return false;
        overlay.style.top = `${top}px`;
        overlay.style.visibility = "visible";
        if (!primaryActionsRemainHitTestable(overlay, regions)) {
            overlay.style.visibility = "hidden";
            return false;
        }
        return true;
    }
    const targetRect = target.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const margin = 12;
    const gap = 12;
    const above = targetRect.top - overlayRect.height - gap;
    const below = targetRect.bottom + gap;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
    const maxTop = Math.max(margin, viewportHeight - overlayRect.height - margin);
    const clampToViewport = (value) => clamp(value, margin, maxTop);
    const scrollArea = regions?.scrollArea && root?.contains(regions.scrollArea)
        ? regions.scrollArea
        : null;
    const isScrollMoving = (element) => {
        if (!scrollArea || typeof getComputedStyle !== "function")
            return false;
        const position = getComputedStyle(element).position;
        return Boolean(scrollArea?.contains(element)) && position !== "fixed" && position !== "sticky";
    };
    const targetIsViewportStable = !isScrollMoving(target);
    const targetIsVisible = targetIsViewportStable &&
        targetRect.bottom > 0 && targetRect.top < window.innerHeight;
    const preferred = targetIsVisible
        ? [
            ...(above >= margin && above <= maxTop ? [above] : []),
            ...(below <= maxTop ? [below] : []),
        ]
        : [];
    const candidates = [
        ...(Number.isFinite(previousTop) ? [clampToViewport(previousTop)] : []),
        ...preferred,
        ...(targetIsViewportStable ? [clampToViewport(above), clampToViewport(below)] : []),
        margin,
        maxTop,
    ];
    const previousLeft = Number.parseFloat(overlay.style.left);
    const left = targetIsViewportStable
        ? clamp(targetRect.left + (targetRect.width - overlayRect.width) / 2, margin, Math.max(margin, viewportWidth - overlayRect.width - margin))
        : clamp(Number.isFinite(previousLeft) ? previousLeft : margin, margin, Math.max(margin, viewportWidth - overlayRect.width - margin));
    const preserveScrollPosition = Number.isFinite(previousTop);
    const obstacles = [
        ...(targetIsViewportStable ? [target] : []),
        ...getGuideProtectedActions(regions).filter((element) => !preserveScrollPosition || !isScrollMoving(element)),
        ...(regions?.guidanceAvoidAreas ?? []).filter((element) => !preserveScrollPosition || !isScrollMoving(element)),
        ...(regions?.viewportOverlays ?? []),
        ...(regions?.bottomControls ?? []),
        ...(typeof document.querySelectorAll === "function"
            ? Array.from(document.querySelectorAll("[data-a11y-qr-entry-dock]"))
            : []),
    ].filter((element) => element !== overlay && element.isConnected &&
        getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" &&
        getVisibleClientRect(element, viewportWidth, viewportHeight) !== null);
    const obstacleEdges = obstacles.flatMap((element) => {
        const rect = getVisibleClientRect(element, viewportWidth, viewportHeight);
        return [clampToViewport(rect.top - overlayRect.height - margin), clampToViewport(rect.bottom + margin)];
    });
    const overlap = (top) => obstacles.reduce((sum, element) => {
        const rect = getVisibleClientRect(element, viewportWidth, viewportHeight);
        if (!rect)
            return sum;
        return sum + Math.max(0, Math.min(left + overlayRect.width, rect.right) - Math.max(left, rect.left)) *
            Math.max(0, Math.min(top + overlayRect.height, rect.bottom) - Math.max(top, rect.top));
    }, 0);
    const uniqueCandidates = [...new Set([...candidates, ...obstacleEdges])];
    const top = uniqueCandidates.find((candidate) => overlap(candidate) === 0);
    if (top === undefined)
        return false;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.visibility = "visible";
    if (!primaryActionsRemainHitTestable(overlay, regions)) {
        overlay.style.visibility = "hidden";
        return false;
    }
    return true;
}
function createGuideOverlay(root, handlers) {
    const aside = document.createElement("aside");
    aside.className = "a11y-guide-toast";
    aside.setAttribute("role", "region");
    aside.setAttribute("aria-label", "도움 안내");
    const icon = document.createElement("span");
    icon.className = "a11y-guide-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "i";
    const header = document.createElement("div");
    header.className = "a11y-guide-header";
    const title = document.createElement("strong");
    title.className = "a11y-guide-title";
    title.dataset.a11yGuideTitle = "true";
    const countdown = document.createElement("span");
    countdown.className = "a11y-guide-countdown";
    countdown.dataset.a11yGuideCountdown = "true";
    countdown.setAttribute("aria-live", "off");
    const copy = document.createElement("div");
    copy.className = "a11y-guide-copy";
    copy.setAttribute("aria-live", "polite");
    const text = document.createElement("span");
    text.dataset.a11yGuideText = "true";
    copy.append(text);
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "a11y-guide-collapse";
    collapse.dataset.a11yGuideCollapse = "true";
    collapse.setAttribute("aria-expanded", "true");
    collapse.setAttribute("aria-label", "안내 접기");
    collapse.textContent = "⌄";
    collapse.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onCollapse();
    });
    const pager = document.createElement("nav");
    pager.className = "a11y-guide-pager";
    pager.dataset.a11yGuidePager = "true";
    pager.setAttribute("aria-label", "쉬운 말 설명 이동");
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "이전";
    previous.dataset.a11yGuidePrevious = "true";
    previous.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onPrevious();
    });
    const page = document.createElement("span");
    page.dataset.a11yGuidePage = "true";
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "다음";
    next.dataset.a11yGuideNext = "true";
    next.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onNext();
    });
    pager.append(previous, page, next);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "a11y-guide-close";
    close.setAttribute("aria-label", "안내 닫기");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onClose();
    });
    header.append(icon, countdown, title, close, collapse);
    aside.append(header, copy, pager);
    const slot = !root.classList.contains("a11y-bottom-viewport-poc-shell") &&
        typeof root.querySelector === "function"
        ? root.querySelector(".a11y-guidance-slot")
        : null;
    (slot ?? root).append(aside);
    return aside;
}
export function createAccessibilitySdk(options) {
    const { root, adapter } = options;
    const addedKioskClass = !root.classList.contains("kiosk");
    root.classList.add("kiosk");
    const originalManagedClasses = new Set(MANAGED_CLASSES.filter((className) => root.classList.contains(className)));
    let currentProfile = { ...DEFAULT_ACCESSIBILITY_PROFILE };
    let guideState = {
        enabled: false,
        paused: true,
        delaySeconds: 15,
        message: null,
    };
    let guideOverlay = null;
    let guideValidationFrame = 0;
    let guidePositionFrame = 0;
    let nextItemRefreshFrame = 0;
    let highlightedAction = null;
    let easyLanguageState = null;
    let easyLanguageIndex = 0;
    let smartGuideVisible = false;
    let guidanceCollapsed = false;
    let guidanceSafetyCollapsed = false;
    let smartGuideCollapseSnapshot = null;
    let guideDeadline = 0;
    let guideCountdownTimer = null;
    let interactionCount = 0;
    let lastScrollAt = 0;
    let destroyed = false;
    let sessionEnded = false;
    let sessionGeneration = 0;
    let completionScreenId = null;
    let completionActive = false;
    const sessionCleanups = new Set();
    const navigationStates = new Map();
    const emphasizedNextButtons = new Set();
    const nextItemObserver = typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((mutations) => {
            const hostLayoutChanged = mutations.some(({ target, type, attributeName }) => {
                if (guideOverlay?.contains(target))
                    return type === "childList";
                // SDK emphasis classes are presentation-only. Observing them here
                // makes the observer react to its own button highlighting.
                if (type === "attributes" && attributeName === "class" &&
                    target instanceof HTMLElement &&
                    (target.classList.contains("a11y-next-item-emphasis") ||
                        target.classList.contains("a11y-guide-emphasis")))
                    return false;
                return true;
            });
            if (!hostLayoutChanged || nextItemRefreshFrame)
                return;
            nextItemRefreshFrame = window.requestAnimationFrame(() => {
                nextItemRefreshFrame = 0;
                if (destroyed)
                    return;
                refreshNextItemButtons();
                if (guideOverlay)
                    scheduleGuidePosition();
            });
        });
    let timer = createIdleTimer(showGuide);
    let guideDismissTimer = null;
    const layoutEnhancer = createLayoutEnhancer(root, adapter, () => currentProfile);
    const menuHint = createScrollGuidance(root, adapter);
    const bottomViewport = createBottomViewportController(root, adapter);
    const screenChange = createScreenChangeController(root, adapter, () => bottomViewport.refresh());
    const completion = createCompletionController((state) => { completionActive = state.active; });
    function currentEasyExplanation() {
        if (!currentProfile.easyLanguage || !easyLanguageState ||
            easyLanguageState.explanations.length === 0 || sessionEnded)
            return null;
        return easyLanguageState.explanations[easyLanguageIndex] ?? null;
    }
    function currentGuidanceMessage() {
        if (smartGuideVisible && guideState.message)
            return guideState.message;
        const explanation = currentEasyExplanation();
        return explanation ? { ...explanation, actionId: null } : null;
    }
    function renderGuidancePanel() {
        const message = currentGuidanceMessage();
        if (!message) {
            removeGuide();
            return;
        }
        menuHint.setEnabled(true);
        if (!guideOverlay) {
            guideOverlay = createGuideOverlay(root, {
                onClose: () => {
                    interactionCount += 1;
                    options.onInteractionCount?.(interactionCount);
                    finishSmartGuide();
                    scheduleGuide();
                },
                onCollapse: () => {
                    guidanceCollapsed = guidanceCollapsed || guidanceSafetyCollapsed
                        ? false
                        : true;
                    guidanceSafetyCollapsed = false;
                    renderGuidancePanel();
                },
                onPrevious: () => {
                    if (easyLanguageIndex > 0)
                        easyLanguageIndex -= 1;
                    renderGuidancePanel();
                },
                onNext: () => {
                    const count = easyLanguageState?.explanations.length ?? 0;
                    if (easyLanguageIndex < count - 1)
                        easyLanguageIndex += 1;
                    renderGuidancePanel();
                },
            });
            window.addEventListener("resize", scheduleGuidePosition, { passive: true });
            window.addEventListener("scroll", scheduleGuidePosition, { capture: true, passive: true });
        }
        const title = guideOverlay.querySelector("[data-a11y-guide-title]");
        const text = guideOverlay.querySelector("[data-a11y-guide-text]");
        const countdown = guideOverlay.querySelector("[data-a11y-guide-countdown]");
        const collapse = guideOverlay.querySelector("[data-a11y-guide-collapse]");
        const pager = guideOverlay.querySelector("[data-a11y-guide-pager]");
        const previous = guideOverlay.querySelector("[data-a11y-guide-previous]");
        const next = guideOverlay.querySelector("[data-a11y-guide-next]");
        const page = guideOverlay.querySelector("[data-a11y-guide-page]");
        const close = guideOverlay.querySelector(".a11y-guide-close");
        if (title)
            title.textContent = message.title;
        if (text)
            text.textContent = message.text;
        if (countdown) {
            const remaining = smartGuideVisible ? Math.max(0, Math.ceil((guideDeadline - Date.now()) / 1000)) : 0;
            countdown.textContent = smartGuideVisible ? `${remaining}초` : "";
            countdown.hidden = !smartGuideVisible;
        }
        const count = smartGuideVisible || !currentEasyExplanation()
            ? 0
            : easyLanguageState?.explanations.length ?? 0;
        if (pager)
            pager.hidden = smartGuideVisible || count < 2;
        if (previous) {
            previous.hidden = smartGuideVisible;
            previous.disabled = easyLanguageIndex === 0;
        }
        if (next) {
            next.hidden = smartGuideVisible;
            next.disabled = easyLanguageIndex >= count - 1;
        }
        if (page) {
            page.hidden = smartGuideVisible || count < 2;
            page.textContent = count > 1 ? `${easyLanguageIndex + 1}/${count}` : "";
        }
        if (close)
            close.hidden = !smartGuideVisible;
        if (collapse) {
            const collapsed = guidanceCollapsed || guidanceSafetyCollapsed;
            collapse.textContent = collapsed ? "⌃" : "⌄";
            collapse.setAttribute("aria-label", collapsed ? "안내 펼치기" : "안내 접기");
            collapse.setAttribute("aria-expanded", String(!collapsed));
        }
        guideOverlay.classList.toggle("a11y-guide-collapsed", guidanceCollapsed || guidanceSafetyCollapsed);
        guideOverlay.classList.toggle("a11y-guide-smart", smartGuideVisible);
        updateGuidePosition();
    }
    function refreshNextItemButtons() {
        if (sessionEnded || destroyed)
            return;
        if (typeof root.querySelectorAll !== "function")
            return;
        const regions = adapter.getLayoutRegions();
        const candidates = new Map();
        const add = (button, list, direction, key) => {
            if (!button || !root.contains(button) || !root.contains(list) ||
                button.disabled || button.getAttribute("aria-disabled") === "true")
                return;
            candidates.set(button, { list, direction, key });
        };
        for (const [index, nav] of (regions.horizontalNavigation ?? []).entries()) {
            const key = nav.list.id || `semantic-list-${index}`;
            const max = Math.max(0, nav.list.scrollWidth - nav.list.clientWidth);
            if (max <= 1)
                continue;
            add(nav.previousButton, nav.list, "backward", key);
            add(nav.nextButton, nav.list, "forward", key);
        }
        const listTerms = "(?:category|menu|item|list|카테고리|메뉴|항목|목록)";
        for (const button of root.querySelectorAll("button[aria-label][aria-controls], [role='button'][aria-label][aria-controls]")) {
            const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.toLocaleLowerCase();
            const direction = new RegExp(`(?:next|다음).*${listTerms}|${listTerms}.*(?:next|다음)`, "i").test(label) ? "forward" :
                new RegExp(`(?:previous|prev|back|이전).*${listTerms}|${listTerms}.*(?:previous|prev|back|이전)`, "i").test(label) ? "backward" :
                    null;
            if (!direction || button.disabled || button.getAttribute("aria-disabled") === "true")
                continue;
            const list = button.getAttribute("aria-controls")?.split(/\s+/)
                .map((id) => document.getElementById(id))
                .find((element) => element instanceof HTMLElement && root.contains(element));
            if (!list || list.scrollWidth <= list.clientWidth + 1)
                continue;
            add(button, list, direction, list.id || "controlled-horizontal-list");
        }
        const activeKeys = new Set([...candidates.values()].map((item) => item.key));
        for (const button of emphasizedNextButtons) {
            if (![...candidates.keys()].includes(button))
                button.classList.remove("a11y-next-item-emphasis");
        }
        emphasizedNextButtons.clear();
        for (const [button, candidate] of candidates) {
            const state = navigationStates.get(candidate.key) ?? {
                seen: new Set(),
                available: new Set(),
            };
            navigationStates.set(candidate.key, state);
            const max = Math.max(0, candidate.list.scrollWidth - candidate.list.clientWidth);
            const available = new Set();
            if (candidate.list.scrollLeft > 1)
                available.add("backward");
            if (max - candidate.list.scrollLeft > 1)
                available.add("forward");
            if (state.activeDirection && !available.has(state.activeDirection))
                stopNavigationEmphasis(state);
            const newlyAvailable = [...available].filter((direction) => !state.available.has(direction) && !state.seen.has(direction));
            state.available = available;
            if (!state.activeButton) {
                const eligible = [
                    ...newlyAvailable,
                    ...[...available].filter((direction) => !newlyAvailable.includes(direction) && !state.seen.has(direction)),
                ];
                const direction = eligible.includes("backward") ? "backward" : eligible[0];
                if (direction) {
                    const matching = [...candidates.entries()].find(([, item]) => item.key === candidate.key && item.direction === direction);
                    if (matching)
                        startNavigationEmphasis(state, matching[0], direction);
                }
            }
            if (state.activeButton === button && state.activeDirection === candidate.direction && available.has(candidate.direction)) {
                button.classList.add("a11y-next-item-emphasis");
                emphasizedNextButtons.add(button);
            }
        }
        for (const key of navigationStates.keys())
            if (!activeKeys.has(key))
                stopNavigationEmphasis(navigationStates.get(key));
    }
    function stopNavigationEmphasis(state) {
        if (state.timer !== undefined)
            window.clearTimeout(state.timer);
        state.timer = undefined;
        state.activeButton?.classList.remove("a11y-next-item-emphasis");
        state.activeButton = undefined;
        state.activeDirection = undefined;
    }
    function startNavigationEmphasis(state, button, direction) {
        if (state.activeButton)
            return;
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        state.activeButton = button;
        state.activeDirection = direction;
        button.classList.add("a11y-next-item-emphasis");
        emphasizedNextButtons.add(button);
        state.timer = window.setTimeout(() => {
            state.seen.add(direction);
            stopNavigationEmphasis(state);
            refreshNextItemButtons();
        }, reduced ? 1600 : 5000);
    }
    function onNavigationClick(event) {
        const target = event.target instanceof Element ? event.target.closest(".a11y-next-item-emphasis, button[aria-controls], [role='button'][aria-controls]") : null;
        if (!target)
            return;
        const regions = adapter.getLayoutRegions();
        const semantic = (regions.horizontalNavigation ?? []).find((nav) => nav.previousButton === target || nav.nextButton === target);
        const listId = semantic?.list.id || target.getAttribute("aria-controls")?.split(/\s+/).find((id) => document.getElementById(id) && root.contains(document.getElementById(id))) || "controlled-horizontal-list";
        const state = navigationStates.get(listId);
        if (!state)
            return;
        const name = `${target.getAttribute("aria-label") ?? ""} ${target.textContent ?? ""}`;
        const direction = semantic
            ? semantic.previousButton === target ? "backward" : "forward"
            : /(?:previous|prev|back|이전).*(?:category|menu|item|list|카테고리|메뉴|항목|목록)|(?:category|menu|item|list|카테고리|메뉴|항목|목록).*(?:previous|prev|back|이전)/i.test(name)
                ? "backward"
                : /(?:next|다음).*(?:category|menu|item|list|카테고리|메뉴|항목|목록)|(?:category|menu|item|list|카테고리|메뉴|항목|목록).*(?:next|다음)/i.test(name)
                    ? "forward"
                    : null;
        if (!direction)
            return;
        state.seen.add(direction);
        stopNavigationEmphasis(state);
        refreshNextItemButtons();
    }
    function removeGuide() {
        const hadGuide = guideOverlay !== null;
        smartGuideVisible = false;
        smartGuideCollapseSnapshot = null;
        guideDeadline = 0;
        if (guideDismissTimer !== null) {
            globalThis.clearTimeout(guideDismissTimer);
            guideDismissTimer = null;
        }
        if (guideCountdownTimer !== null) {
            globalThis.clearTimeout(guideCountdownTimer);
            guideCountdownTimer = null;
        }
        if (guidePositionFrame) {
            window.cancelAnimationFrame(guidePositionFrame);
            guidePositionFrame = 0;
        }
        if (guideOverlay) {
            guideOverlay.remove();
            guideOverlay = null;
            window.removeEventListener("resize", scheduleGuidePosition);
            window.removeEventListener("scroll", scheduleGuidePosition, true);
        }
        highlightedAction?.classList.remove("a11y-guide-emphasis");
        highlightedAction = null;
        if (hadGuide) {
            menuHint.setEnabled(true);
            menuHint.refresh();
        }
    }
    function finishSmartGuide() {
        smartGuideVisible = false;
        guideDeadline = 0;
        if (guideDismissTimer !== null)
            globalThis.clearTimeout(guideDismissTimer);
        if (guideCountdownTimer !== null)
            globalThis.clearTimeout(guideCountdownTimer);
        guideDismissTimer = null;
        guideCountdownTimer = null;
        if (smartGuideCollapseSnapshot) {
            guidanceCollapsed = smartGuideCollapseSnapshot.collapsed;
            guidanceSafetyCollapsed = smartGuideCollapseSnapshot.safetyCollapsed;
            smartGuideCollapseSnapshot = null;
        }
        highlightedAction?.classList.remove("a11y-guide-emphasis");
        highlightedAction = null;
        if (currentEasyExplanation())
            renderGuidancePanel();
        else
            removeGuide();
    }
    function findGuideAction(actionId) {
        if (!actionId)
            return null;
        return adapter.getActions().find((action) => action.id === actionId) ?? null;
    }
    function scheduleGuideHitTest(target, action) {
        if (guideValidationFrame)
            window.cancelAnimationFrame(guideValidationFrame);
        const overlay = guideOverlay;
        if (!overlay)
            return;
        if (typeof overlay.ownerDocument?.elementFromPoint !== "function")
            return;
        guideValidationFrame = window.requestAnimationFrame(() => {
            guideValidationFrame = 0;
            if (guideOverlay !== overlay || primaryActionsRemainHitTestable(overlay, adapter.getLayoutRegions()))
                return;
            const rect = target.getBoundingClientRect();
            options.onDiagnostics?.([{
                    screenId: adapter.getSnapshot().screenId,
                    semanticId: action?.id || target.id || "guide-placement",
                    issueType: "guide-suppressed",
                    severity: "warning",
                    elementTag: target.tagName.toLowerCase(),
                    elementRect: {
                        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                        width: rect.width, height: rect.height,
                    },
                    viewport: { width: innerWidth, height: innerHeight },
                    profile: {
                        textSize: currentProfile.textSize,
                        buttonSize: currentProfile.buttonSize,
                        contrast: currentProfile.contrast,
                        viewportMode: currentProfile.viewportMode?.heightPercent ?? null,
                    },
                    measurements: { postLayoutHitTestFailed: true },
                    recommendation: "Guidance was temporarily hidden because it covered a registered host action after layout.",
                }]);
            overlay.style.visibility = "hidden";
            overlay.setAttribute("aria-hidden", "true");
            overlay.dataset.a11yPositionSuppressed = "true";
            menuHint.setEnabled(true);
        });
    }
    function updateGuidePosition() {
        if (!guideOverlay)
            return;
        const action = smartGuideVisible
            ? findGuideAction(guideState.message?.actionId ?? null)
            : adapter.getActions().find((item) => item.primary && item.enabled) ??
                adapter.getActions().find((item) => item.enabled);
        const target = action?.element ?? root;
        if (!positionGuide(guideOverlay, target, root, adapter.getLayoutRegions())) {
            if (!(guidanceCollapsed || guidanceSafetyCollapsed)) {
                guidanceSafetyCollapsed = true;
                guideOverlay.classList.add("a11y-guide-collapsed");
                const collapse = guideOverlay.querySelector("[data-a11y-guide-collapse]");
                if (collapse) {
                    collapse.textContent = "∧ 펼치기";
                    collapse.setAttribute("aria-expanded", "false");
                }
                if (positionGuide(guideOverlay, target, root, adapter.getLayoutRegions())) {
                    guideOverlay.setAttribute("aria-hidden", "false");
                    delete guideOverlay.dataset.a11yPositionSuppressed;
                    menuHint.setEnabled(!smartGuideVisible);
                    scheduleGuideHitTest(target, action);
                    return;
                }
            }
            const guideRect = guideOverlay.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const screenId = adapter.getSnapshot().screenId;
            options.onDiagnostics?.([{
                    screenId,
                    semanticId: action?.id || target.id || "guide-placement",
                    issueType: "guide-suppressed",
                    severity: "warning",
                    elementTag: target.tagName.toLowerCase(),
                    elementRect: {
                        left: targetRect.left,
                        top: targetRect.top,
                        right: targetRect.right,
                        bottom: targetRect.bottom,
                        width: targetRect.width,
                        height: targetRect.height,
                    },
                    viewport: { width: innerWidth, height: innerHeight },
                    profile: {
                        textSize: currentProfile.textSize,
                        buttonSize: currentProfile.buttonSize,
                        contrast: currentProfile.contrast,
                        viewportMode: currentProfile.viewportMode?.heightPercent ?? null,
                    },
                    measurements: {
                        expandedHeight: guideRect.height,
                        targetOverlap: guideRect.left < targetRect.right && guideRect.right > targetRect.left &&
                            guideRect.top < targetRect.bottom && guideRect.bottom > targetRect.top,
                        safetyCollapsed: guidanceSafetyCollapsed,
                    },
                    recommendation: "Guidance retained but temporarily hidden because no safe position passed registered-action overlap and pointer hit-test checks.",
                }]);
            guideOverlay.style.visibility = "hidden";
            guideOverlay.setAttribute("aria-hidden", "true");
            guideOverlay.dataset.a11yPositionSuppressed = "true";
            menuHint.setEnabled(true);
            return;
        }
        guideOverlay.setAttribute("aria-hidden", "false");
        delete guideOverlay.dataset.a11yPositionSuppressed;
        menuHint.setEnabled(true);
        if (guideOverlay)
            scheduleGuideHitTest(target, action);
    }
    function scheduleGuidePosition() {
        if (destroyed || guidePositionFrame)
            return;
        guidePositionFrame = window.requestAnimationFrame(() => {
            guidePositionFrame = 0;
            updateGuidePosition();
        });
    }
    function showGuide() {
        if (destroyed ||
            completionActive ||
            smartGuideVisible ||
            !currentProfile.smartGuide ||
            !guideState.enabled ||
            guideState.paused ||
            !guideState.message?.actionId) {
            return;
        }
        const action = findGuideAction(guideState.message.actionId);
        const target = action?.element ?? null;
        if (!action || !target || !root.contains(target))
            return;
        if (smartGuideVisible)
            finishSmartGuide();
        smartGuideCollapseSnapshot = {
            collapsed: guidanceCollapsed,
            safetyCollapsed: guidanceSafetyCollapsed,
        };
        menuHint.setEnabled(false);
        smartGuideVisible = true;
        const displayMs = currentProfile.slowGuidance ? 15_000 : GUIDE_AUTO_DISMISS_MS;
        guideDeadline = Date.now() + displayMs;
        highlightedAction = action.highlightElement ?? target;
        highlightedAction.classList.add("a11y-guide-emphasis");
        renderGuidancePanel();
        if (!guideOverlay)
            return;
        const visibleGuide = guideOverlay;
        guideDismissTimer = globalThis.setTimeout(() => {
            if (guideOverlay !== visibleGuide)
                return;
            guideDismissTimer = null;
            finishSmartGuide();
        }, displayMs);
        const updateCountdown = () => {
            if (guideOverlay !== visibleGuide || !smartGuideVisible)
                return;
            const remaining = Math.max(0, Math.ceil((guideDeadline - Date.now()) / 1000));
            const countdown = visibleGuide.querySelector("[data-a11y-guide-countdown]");
            if (countdown)
                countdown.textContent = `${remaining}초`;
            if (remaining > 0) {
                guideCountdownTimer = globalThis.setTimeout(updateCountdown, Math.min(1000, guideDeadline - Date.now()));
            }
        };
        guideCountdownTimer = globalThis.setTimeout(updateCountdown, 1000);
        speakText(guideState.message.text, currentProfile.voiceGuidance);
        menuHint.refresh();
    }
    function scheduleGuide() {
        timer.cancel();
        if (destroyed ||
            completionActive ||
            smartGuideVisible ||
            !currentProfile.smartGuide ||
            !guideState.enabled ||
            guideState.paused ||
            !guideState.message?.actionId) {
            return;
        }
        timer.reset(smartGuideDelayMs(guideState.delaySeconds));
    }
    function recordInteraction(event) {
        if (destroyed)
            return;
        if (guideOverlay && event?.target instanceof Node && guideOverlay.contains(event.target))
            return;
        interactionCount += 1;
        options.onInteractionCount?.(interactionCount);
        // User activity on the current screen must not end or extend the visible
        // guide. Only a host-reported step transition or the display deadline does.
        if (smartGuideVisible)
            return;
        scheduleGuide();
    }
    function recordScrollInteraction() {
        const now = Date.now();
        if (now - lastScrollAt < 250)
            return;
        lastScrollAt = now;
        if (smartGuideVisible) {
            interactionCount += 1;
            options.onInteractionCount?.(interactionCount);
            return;
        }
        recordInteraction();
    }
    function applyProfile(input) {
        sessionEnded = false;
        menuHint.setEnabled(!smartGuideVisible);
        const previousVoiceGuidance = currentProfile.voiceGuidance;
        currentProfile = validateAccessibilityProfile(input);
        const nextClasses = new Set(accessibilityClasses(currentProfile));
        for (const className of MANAGED_CLASSES) {
            root.classList.toggle(className, nextClasses.has(className));
        }
        layoutEnhancer.applyProfile();
        if (currentProfile.textSize !== "standard" ||
            currentProfile.buttonSize === "large" ||
            currentProfile.bottomControls) {
            layoutEnhancer.correctLayout();
        }
        // The QR profile is the source of truth for the viewport mode. Applying
        // v1/v2 normalizes it to null, while v3 applies its explicit setting here.
        setViewportMode(currentProfile.viewportMode);
        menuHint.refresh();
        refreshNextItemButtons();
        if (previousVoiceGuidance && !currentProfile.voiceGuidance)
            cancelSpeech();
        if (!currentProfile.smartGuide && smartGuideVisible)
            finishSmartGuide();
        else if (!currentProfile.easyLanguage && !smartGuideVisible)
            removeGuide();
        else
            renderGuidancePanel();
        scheduleGuide();
        return { ...currentProfile };
    }
    function setEasyLanguageState(state) {
        const stepId = typeof state.stepId === "string" ? state.stepId : "";
        const explanations = Array.isArray(state.explanations)
            ? state.explanations.slice(0, 100).filter((item) => item && typeof item.title === "string" && typeof item.text === "string" &&
                item.title.trim().length > 0 && item.text.trim().length > 0).map((item) => ({ title: item.title.slice(0, 300), text: item.text.slice(0, 3000) }))
            : [];
        if (easyLanguageState?.stepId !== stepId) {
            easyLanguageIndex = 0;
            guidanceCollapsed = false;
            guidanceSafetyCollapsed = false;
        }
        easyLanguageState = stepId && explanations.length > 0 ? { stepId, explanations } : null;
        easyLanguageIndex = Math.min(easyLanguageIndex, Math.max(0, explanations.length - 1));
        if (!smartGuideVisible)
            renderGuidancePanel();
    }
    function setGuideState(state) {
        const previous = guideState;
        const previousStepId = previous.stepId ??
            `${adapter.getSnapshot().screenId}:${previous.message?.actionId ?? ""}`;
        const nextStepId = state.stepId ??
            `${adapter.getSnapshot().screenId}:${state.message?.actionId ?? ""}`;
        const sameStep = previousStepId === nextStepId &&
            previous.enabled === state.enabled &&
            previous.paused === state.paused &&
            previous.delaySeconds === state.delaySeconds;
        guideState = { ...state, message: state.message ? { ...state.message } : null };
        if (sameStep) {
            if (smartGuideVisible || currentEasyExplanation())
                renderGuidancePanel();
            return;
        }
        const keepMatchingEasyPanel = currentProfile.easyLanguage &&
            easyLanguageState?.stepId === nextStepId;
        if (easyLanguageState && !keepMatchingEasyPanel) {
            easyLanguageState = null;
            easyLanguageIndex = 0;
        }
        if (!keepMatchingEasyPanel || smartGuideVisible) {
            if (smartGuideVisible && keepMatchingEasyPanel)
                finishSmartGuide();
            else
                removeGuide();
        }
        renderGuidancePanel();
        scheduleGuide();
        menuHint.refresh();
    }
    function resetIdleTimer() {
        recordInteraction();
    }
    function speak(text) {
        return speakText(text, currentProfile.voiceGuidance);
    }
    function inspectLayout() {
        const corrections = layoutEnhancer.getLastCorrections();
        const recommendation = {
            "text-clipped": "텍스트 컨테이너의 높이·줄 간격·overflow 설정을 확인하세요.",
            "text-obscured": "안내 문구와 실제 고정 조작 버튼의 겹침을 확인하세요.",
            "horizontal-overflow": "컨테이너 최소 너비와 그리드 열 수를 확인하세요.",
            "action-offscreen": "업무 버튼이 스크롤 영역 안에 등록되어 있는지 확인하세요.",
            "bottom-control-obscures-action": "스크롤 영역과 고정 조작부의 경계를 확인하세요.",
            "last-scroll-action-obscured": "스크롤 끝 여백과 고정 조작부 등록을 확인하세요.",
            "small-touch-target": "버튼의 최소 터치 크기를 확인하세요.",
            "action-overlap": "인접한 업무 버튼의 flex/grid 배치를 확인하세요.",
            "menu-overflow-unreachable": "메뉴 목록의 스크롤 가능 여부를 확인하세요.",
        };
        const issues = inspectKioskLayout(root, adapter).map((issue) => {
            const element = [...adapter.getTextTargets(), ...(adapter.getFontCorrectionTargets?.() ?? [])]
                .find((item) => item.id === issue.semanticId)?.element ??
                adapter.getActions().find((item) => item.id === issue.semanticId)?.element ??
                (issue.semanticId === "kiosk.root" ? root : null);
            const rect = element?.getBoundingClientRect();
            const correction = corrections.find((item) => item.targetId === issue.semanticId);
            return {
                ...issue,
                severity: issue.issueType === "small-touch-target" ? "warning" : "error",
                ...(element ? { elementTag: element.tagName.toLowerCase() } : {}),
                ...(rect ? { elementRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } } : {}),
                viewport: { width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight },
                profile: {
                    textSize: currentProfile.textSize,
                    buttonSize: currentProfile.buttonSize,
                    contrast: currentProfile.contrast,
                    viewportMode: currentProfile.viewportMode?.heightPercent ?? null,
                },
                recommendation: recommendation[issue.issueType],
                autoCorrection: correction?.outcome === "applied" ? "applied" :
                    correction?.outcome === "failed" ? "failed" : "not-attempted",
            };
        });
        options.onDiagnostics?.(issues);
        return issues;
    }
    function correctLayout() {
        return layoutEnhancer.correctLayout();
    }
    function getLastLayoutCorrections() {
        return layoutEnhancer.getLastCorrections();
    }
    function setViewportMode(config) {
        const applied = bottomViewport.apply(config);
        syncQrEntryDockViewportMode(root, config?.mode === "bottom" ? config.heightPercent : null);
        if (applied) {
            menuHint.refresh();
            if (guideOverlay)
                updateGuidePosition();
        }
        return applied;
    }
    function notifyScreenChange(screenId) {
        const changed = screenChange.notify(screenId);
        if (changed) {
            easyLanguageState = null;
            easyLanguageIndex = 0;
            if (completionActive && completionScreenId !== screenId) {
                completion.cancel();
                completionScreenId = null;
            }
            timer.cancel();
            removeGuide();
            menuHint.refresh();
        }
        return changed;
    }
    function beginCompletion(onReturn) {
        if (destroyed || sessionEnded)
            return;
        timer.cancel();
        removeGuide();
        completionScreenId = adapter.getSnapshot().screenId;
        completion.begin(onReturn);
    }
    function cancelCompletion() {
        completionScreenId = null;
        completion.cancel();
    }
    function endSession() {
        sessionGeneration += 1;
        screenChange.reset();
        timer.cancel();
        cancelCompletion();
        for (const cleanup of [...sessionCleanups]) {
            try {
                cleanup();
            }
            catch (error) {
                try {
                    options.onSessionCleanupError?.(error);
                }
                catch {
                    // Cleanup reporting must not block the remaining session reset.
                }
            }
        }
        guideState = {
            enabled: false,
            paused: true,
            delaySeconds: 15,
            message: null,
        };
        easyLanguageState = null;
        easyLanguageIndex = 0;
        guidanceCollapsed = false;
        guidanceSafetyCollapsed = false;
        for (const state of navigationStates.values())
            stopNavigationEmphasis(state);
        navigationStates.clear();
        removeGuide();
        cancelSpeech();
        bottomViewport.apply(null);
        applyProfile(DEFAULT_ACCESSIBILITY_PROFILE);
        sessionEnded = true;
        for (const state of navigationStates.values())
            stopNavigationEmphasis(state);
        navigationStates.clear();
        for (const button of emphasizedNextButtons)
            button.classList.remove("a11y-next-item-emphasis");
        emphasizedNextButtons.clear();
        menuHint.setEnabled(false);
        menuHint.clear();
        interactionCount = 0;
        options.onInteractionCount?.(0);
    }
    function registerSessionCleanup(cleanup) {
        if (destroyed) {
            cleanup();
            return () => undefined;
        }
        sessionCleanups.add(cleanup);
        return () => sessionCleanups.delete(cleanup);
    }
    function createSessionGuard() {
        const generation = sessionGeneration;
        return () => !destroyed && sessionGeneration === generation;
    }
    root.addEventListener("pointerdown", recordInteraction);
    root.addEventListener("keydown", recordInteraction);
    root.addEventListener("scroll", refreshNextItemButtons, true);
    root.addEventListener("click", onNavigationClick, true);
    window.addEventListener("resize", refreshNextItemButtons, { passive: true });
    if (options.viewportMode)
        setViewportMode(options.viewportMode);
    nextItemObserver?.observe(document.body ?? root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "aria-controls", "aria-disabled", "disabled", "hidden", "aria-hidden"],
    });
    refreshNextItemButtons();
    if (!("PointerEvent" in window))
        root.addEventListener("touchstart", recordInteraction, { passive: true });
    window.addEventListener("scroll", recordScrollInteraction, { capture: true, passive: true });
    const sdk = {
        version: ACCESSIBILITY_SDK_VERSION,
        get profile() {
            return { ...currentProfile };
        },
        applyProfile,
        notifyScreenChange,
        setViewportMode,
        setGuideState,
        setEasyLanguageState,
        beginCompletion,
        extendCompletion: () => completion.extend(),
        cancelCompletion,
        finishCompletion: () => completion.finish(),
        subscribeCompletion: (listener) => completion.subscribe(listener),
        get completionState() { return completion.state; },
        resetIdleTimer,
        speak,
        inspectLayout,
        correctLayout,
        getLastLayoutCorrections,
        endSession,
        registerSessionCleanup,
        createSessionGuard,
        destroy() {
            if (destroyed)
                return;
            endSession();
            destroyed = true;
            screenChange.destroy();
            nextItemObserver?.disconnect();
            if (nextItemRefreshFrame)
                window.cancelAnimationFrame(nextItemRefreshFrame);
            if (guidePositionFrame)
                window.cancelAnimationFrame(guidePositionFrame);
            for (const button of emphasizedNextButtons)
                button.classList.remove("a11y-next-item-emphasis");
            emphasizedNextButtons.clear();
            timer.dispose();
            completion.dispose();
            removeGuide();
            layoutEnhancer.destroy();
            bottomViewport.destroy();
            menuHint.destroy();
            root.removeEventListener("pointerdown", recordInteraction);
            root.removeEventListener("keydown", recordInteraction);
            root.removeEventListener("scroll", refreshNextItemButtons, true);
            root.removeEventListener("click", onNavigationClick, true);
            window.removeEventListener("resize", refreshNextItemButtons);
            root.removeEventListener("touchstart", recordInteraction);
            window.removeEventListener("scroll", recordScrollInteraction, true);
            for (const className of MANAGED_CLASSES) {
                root.classList.toggle(className, originalManagedClasses.has(className));
            }
            if (addedKioskClass)
                root.classList.remove("kiosk");
            sessionCleanups.clear();
        },
    };
    return sdk;
}
//# sourceMappingURL=accessibility-sdk.js.map