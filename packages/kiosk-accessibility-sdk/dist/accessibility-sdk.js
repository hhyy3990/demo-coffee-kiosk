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
function positionGuide(overlay, target, root, regions) {
    if (!target || !target.isConnected)
        return false;
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
        const safeTop = Math.max(0, shell.top) + 8;
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
            ...(regions?.primaryActions ?? []).map(({ element }) => element),
            ...(regions?.viewportOverlays ?? []),
            ...(regions?.guidanceAvoidAreas ?? []),
            ...controls,
        ].filter((el) => el !== overlay && el.isConnected &&
            getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" &&
            el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
        const fits = positions.map((candidate) => clamp(candidate, minimum, maximum));
        fits.push(minimum, maximum, minimum + (maximum - minimum) / 2);
        const candidates = [...new Set(fits.filter(Number.isFinite))];
        const overlapsAt = (candidate, element) => {
            const rect = element.getBoundingClientRect();
            return 12 < rect.right && vw - 12 > rect.left &&
                candidate < rect.bottom && candidate + height > rect.top;
        };
        const top = candidates.find((candidate) => !obstacles.some((element) => overlapsAt(candidate, element))) ?? candidates
            .map((candidate) => ({
            candidate,
            overlap: obstacles.reduce((sum, element) => {
                const rect = element.getBoundingClientRect();
                if (!overlapsAt(candidate, element))
                    return sum;
                return sum + Math.max(0, Math.min(candidate + height, rect.bottom) - Math.max(candidate, rect.top)) *
                    Math.max(0, Math.min(vw - 12, rect.right) - Math.max(12, rect.left));
            }, 0),
        }))
            .sort((a, b) => a.overlap - b.overlap)[0]?.candidate;
        if (top === undefined || maximum < minimum)
            return false;
        overlay.style.top = `${top}px`;
        overlay.style.visibility = "visible";
        return true;
    }
    const targetRect = target.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const margin = 12;
    const gap = 12;
    const above = targetRect.top - overlayRect.height - gap;
    const below = targetRect.bottom + gap;
    const maxTop = Math.max(margin, window.innerHeight - overlayRect.height - margin);
    const clampToViewport = (value) => clamp(value, margin, maxTop);
    const targetIsVisible = targetRect.bottom > 0 && targetRect.top < window.innerHeight;
    const preferred = targetIsVisible
        ? [
            ...(above >= margin && above <= maxTop ? [above] : []),
            ...(below <= maxTop ? [below] : []),
        ]
        : [];
    const candidates = [...preferred, clampToViewport(above), clampToViewport(below), margin, maxTop];
    const top = [...new Set(candidates)][0];
    const left = clamp(targetRect.left + (targetRect.width - overlayRect.width) / 2, margin, Math.max(margin, window.innerWidth - overlayRect.width - margin));
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    return true;
}
function createGuideOverlay(root, message, onClose) {
    const aside = document.createElement("aside");
    aside.className = "a11y-guide-toast";
    aside.setAttribute("role", "status");
    aside.setAttribute("aria-live", "polite");
    const icon = document.createElement("span");
    icon.className = "a11y-guide-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "i";
    const copy = document.createElement("p");
    const title = document.createElement("strong");
    title.dataset.a11yGuideTitle = "true";
    title.textContent = message.title;
    const text = document.createElement("span");
    text.dataset.a11yGuideText = "true";
    text.textContent = message.text;
    copy.append(title, text);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "a11y-guide-close";
    close.setAttribute("aria-label", "스마트 길잡이 닫기");
    close.textContent = "×";
    close.addEventListener("pointerdown", (event) => event.stopPropagation());
    close.addEventListener("touchstart", (event) => event.stopPropagation());
    close.addEventListener("keydown", (event) => event.stopPropagation());
    close.addEventListener("click", (event) => {
        event.stopPropagation();
        onClose();
    });
    aside.append(icon, copy, close);
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
    let highlightedAction = null;
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
        : new MutationObserver(() => {
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
        if (guideDismissTimer !== null) {
            globalThis.clearTimeout(guideDismissTimer);
            guideDismissTimer = null;
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
    function findGuideAction(actionId) {
        if (!actionId)
            return null;
        return adapter.getActions().find((action) => action.id === actionId) ?? null;
    }
    function updateGuidePosition() {
        if (!guideOverlay || !guideState.message?.actionId)
            return;
        const action = findGuideAction(guideState.message.actionId);
        if (!positionGuide(guideOverlay, action?.element ?? null, root, adapter.getLayoutRegions())) {
            removeGuide();
        }
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
        removeGuide();
        menuHint.setEnabled(false);
        highlightedAction = action.highlightElement ?? target;
        highlightedAction.classList.add("a11y-guide-emphasis");
        guideOverlay = createGuideOverlay(root, guideState.message, () => {
            interactionCount += 1;
            options.onInteractionCount?.(interactionCount);
            removeGuide();
            scheduleGuide();
        });
        if (!positionGuide(guideOverlay, target, root, adapter.getLayoutRegions())) {
            removeGuide();
            return;
        }
        const visibleGuide = guideOverlay;
        guideDismissTimer = globalThis.setTimeout(() => {
            if (guideOverlay !== visibleGuide)
                return;
            guideDismissTimer = null;
            removeGuide();
        }, GUIDE_AUTO_DISMISS_MS);
        window.addEventListener("resize", updateGuidePosition);
        window.addEventListener("scroll", updateGuidePosition, true);
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
    function recordInteraction() {
        if (destroyed)
            return;
        interactionCount += 1;
        options.onInteractionCount?.(interactionCount);
        removeGuide();
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
        if (!currentProfile.smartGuide)
            removeGuide();
        scheduleGuide();
        return { ...currentProfile };
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
            if (guideOverlay && guideState.message) {
                const title = guideOverlay.querySelector("[data-a11y-guide-title]");
                const text = guideOverlay.querySelector("[data-a11y-guide-text]");
                if (title)
                    title.textContent = guideState.message.title;
                if (text)
                    text.textContent = guideState.message.text;
                const action = findGuideAction(guideState.message.actionId);
                if (!positionGuide(guideOverlay, action?.element ?? null, root, adapter.getLayoutRegions())) {
                    removeGuide();
                }
            }
            return;
        }
        removeGuide();
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
    nextItemObserver?.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "aria-controls", "aria-disabled", "disabled", "hidden", "aria-hidden"],
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