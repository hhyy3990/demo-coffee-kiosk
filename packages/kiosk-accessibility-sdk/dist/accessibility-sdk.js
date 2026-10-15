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
    return getGuideProtectedActions(regions).every((element) => {
        if (!element.isConnected || ("disabled" in element && Boolean(element.disabled)))
            return true;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility === "hidden")
            return true;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight)
            return true;
        const hit = hitTest(x, y);
        return hit === element || element.contains(hit);
    });
}
function positionGuide(overlay, target, root, regions) {
    if (!target || !target.isConnected)
        return false;
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
        const shell = (regions?.scrollArea && root.contains(regions.scrollArea)
            ? regions.scrollArea
            : root).getBoundingClientRect();
        const qrDocks = Array.from(document.querySelectorAll("[data-a11y-qr-entry-dock]"));
        const controls = [...(regions?.bottomControls ?? []), ...qrDocks].filter((el) => el.isConnected && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none");
        const safeBottom = controls.reduce((edge, el) => Math.min(edge, el.getBoundingClientRect().top), Math.min(vh, shell.bottom)) - 8;
        // The guide is a viewport overlay, so the scroll area's lower start edge
        // must not trap it between a keypad and the fixed bottom controls.
        const safeTop = 8;
        const availableHeight = safeBottom - safeTop;
        if (availableHeight < 72)
            return false;
        overlay.style.position = "fixed";
        overlay.style.left = `${Math.max(12, (vw - Math.min(500, vw - 24)) / 2)}px`;
        overlay.style.top = `${safeTop}px`;
        overlay.style.bottom = "auto";
        overlay.style.width = `min(500px, calc(100vw - 24px))`;
        overlay.style.maxHeight = `${availableHeight}px`;
        overlay.style.overflowY = "auto";
        overlay.style.visibility = "hidden";
        const height = overlay.getBoundingClientRect().height;
        const action = target.getBoundingClientRect();
        const minimum = safeTop;
        const maximum = safeBottom - height;
        const positions = [action.top - height - 12, action.bottom + 12];
        const obstacles = [
            ...getGuideProtectedActions(regions),
            ...(regions?.viewportOverlays ?? []),
            ...(regions?.guidanceAvoidAreas ?? []),
            ...controls,
        ].filter((el) => el !== overlay && el.isConnected &&
            getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" &&
            el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
        const obstacleEdges = obstacles.flatMap((element) => {
            const rect = element.getBoundingClientRect();
            return [rect.top - height - 8, rect.bottom + 8]
                .map((candidate) => clamp(candidate, minimum, maximum));
        });
        const fits = positions.map((candidate) => clamp(candidate, minimum, maximum));
        fits.push(minimum, maximum, minimum + (maximum - minimum) / 2);
        const candidates = [...new Set([...fits, ...obstacleEdges].filter(Number.isFinite))];
        const overlapsAt = (candidate, element) => {
            const rect = element.getBoundingClientRect();
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
    const targetIsVisible = targetRect.bottom > 0 && targetRect.top < window.innerHeight;
    const preferred = targetIsVisible
        ? [
            ...(above >= margin && above <= maxTop ? [above] : []),
            ...(below <= maxTop ? [below] : []),
        ]
        : [];
    const candidates = [...preferred, clampToViewport(above), clampToViewport(below), margin, maxTop];
    const left = clamp(targetRect.left + (targetRect.width - overlayRect.width) / 2, margin, Math.max(margin, viewportWidth - overlayRect.width - margin));
    const obstacles = [
        ...getGuideProtectedActions(regions),
        ...(regions?.guidanceAvoidAreas ?? []),
        ...(regions?.viewportOverlays ?? []),
        ...(regions?.bottomControls ?? []),
        ...(typeof document.querySelectorAll === "function"
            ? Array.from(document.querySelectorAll("[data-a11y-qr-entry-dock]"))
            : []),
    ].filter((element) => element !== overlay && element.isConnected &&
        getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
    const obstacleEdges = obstacles.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return [clampToViewport(rect.top - overlayRect.height - margin), clampToViewport(rect.bottom + margin)];
    });
    const overlap = (top) => obstacles.reduce((sum, element) => {
        const rect = element.getBoundingClientRect();
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
    const copy = document.createElement("div");
    copy.className = "a11y-guide-copy";
    copy.setAttribute("aria-live", "polite");
    const title = document.createElement("strong");
    title.dataset.a11yGuideTitle = "true";
    const text = document.createElement("span");
    text.dataset.a11yGuideText = "true";
    copy.append(title, text);
    const header = document.createElement("div");
    header.className = "a11y-guide-header";
    const countdown = document.createElement("span");
    countdown.className = "a11y-guide-countdown";
    countdown.dataset.a11yGuideCountdown = "true";
    countdown.setAttribute("aria-live", "off");
    header.append(countdown);
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "a11y-guide-collapse";
    collapse.dataset.a11yGuideCollapse = "true";
    collapse.setAttribute("aria-expanded", "true");
    collapse.textContent = "∨ 접기";
    collapse.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onCollapse();
    });
    header.append(collapse);
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
    aside.append(header, icon, copy, pager, close);
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
    let highlightedAction = null;
    let easyLanguageState = null;
    let easyLanguageIndex = 0;
    let smartGuideVisible = false;
    let guidanceCollapsed = false;
    let guidanceSafetyCollapsed = false;
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
            const hostLayoutChanged = mutations.some(({ target, type }) => !guideOverlay || !guideOverlay.contains(target) || type === "childList");
            if (!hostLayoutChanged)
                return;
            refreshNextItemButtons();
            if (guideOverlay)
                updateGuidePosition();
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
        if (!guideOverlay) {
            menuHint.setEnabled(false);
            guideOverlay = createGuideOverlay(root, {
                onClose: () => {
                    interactionCount += 1;
                    options.onInteractionCount?.(interactionCount);
                    finishSmartGuide();
                    scheduleGuide();
                },
                onCollapse: () => {
                    guidanceCollapsed = !guidanceCollapsed;
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
            window.addEventListener("resize", updateGuidePosition);
            window.addEventListener("scroll", updateGuidePosition, true);
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
        const count = currentEasyExplanation() ? easyLanguageState?.explanations.length ?? 0 : 0;
        if (pager)
            pager.hidden = smartGuideVisible || count < 2;
        if (previous)
            previous.disabled = easyLanguageIndex === 0;
        if (next)
            next.disabled = easyLanguageIndex >= count - 1;
        if (page)
            page.textContent = count > 1 ? `${easyLanguageIndex + 1}/${count}` : "";
        if (close)
            close.hidden = !smartGuideVisible;
        if (collapse) {
            collapse.textContent = guidanceCollapsed || guidanceSafetyCollapsed ? "∧ 펼치기" : "∨ 접기";
            collapse.setAttribute("aria-expanded", String(!(guidanceCollapsed || guidanceSafetyCollapsed)));
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
        guideDeadline = 0;
        if (guideDismissTimer !== null) {
            globalThis.clearTimeout(guideDismissTimer);
            guideDismissTimer = null;
        }
        if (guideCountdownTimer !== null) {
            globalThis.clearTimeout(guideCountdownTimer);
            guideCountdownTimer = null;
        }
        if (guideOverlay) {
            guideOverlay.remove();
            guideOverlay = null;
            window.removeEventListener("resize", updateGuidePosition);
            window.removeEventListener("scroll", updateGuidePosition, true);
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
                    recommendation: "Smart Guide was hidden because it covered a registered host action after layout.",
                }]);
            overlay.style.visibility = "hidden";
            removeGuide();
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
                    recommendation: "Guide hidden: no position passed registered-action overlap and pointer hit-test checks.",
                }]);
            removeGuide();
        }
        if (guideOverlay)
            scheduleGuideHitTest(target, action);
    }
    function showGuide() {
        if (destroyed ||
            completionActive ||
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
        if (smartGuideVisible)
            finishSmartGuide();
        scheduleGuide();
    }
    function recordScrollInteraction() {
        const now = Date.now();
        if (now - lastScrollAt < 250)
            return;
        lastScrollAt = now;
        recordInteraction();
    }
    function applyProfile(input) {
        sessionEnded = false;
        menuHint.setEnabled(guideOverlay === null);
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
        if (easyLanguageState?.stepId !== stepId)
            easyLanguageIndex = 0;
        easyLanguageState = stepId ? { stepId, explanations } : null;
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
        attributeFilter: ["aria-label", "aria-controls", "aria-disabled", "disabled", "hidden", "aria-hidden", "class"],
    });
    refreshNextItemButtons();
    if (!("PointerEvent" in window))
        root.addEventListener("touchstart", recordInteraction, { passive: true });
    window.addEventListener("scroll", recordScrollInteraction, { passive: true });
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
            window.removeEventListener("scroll", recordScrollInteraction);
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