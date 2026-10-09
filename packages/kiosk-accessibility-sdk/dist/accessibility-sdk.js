import { inspectKioskLayout } from "./diagnostics.js";
import { createIdleTimer, smartGuideDelayMs } from "./guide.js";
import { ACCESSIBILITY_SDK_VERSION, accessibilityClasses, DEFAULT_ACCESSIBILITY_PROFILE, validateAccessibilityProfile, } from "./profile.js";
import { cancelSpeech, speakText } from "./speech.js";
const MANAGED_CLASSES = [
    "a11y-text-large",
    "a11y-text-extra",
    "a11y-controls-large",
    "a11y-high-contrast",
    "a11y-easy-language",
    "a11y-simplified",
    "a11y-bottom-controls",
];
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
function positionGuide(overlay, target) {
    if (!target || !target.isConnected)
        return;
    const targetRect = target.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const margin = 12;
    const gap = 12;
    const above = targetRect.top - overlayRect.height - gap;
    const below = targetRect.bottom + gap;
    const canFitAbove = above >= margin;
    const canFitBelow = below + overlayRect.height <= window.innerHeight - margin;
    let top;
    if (canFitAbove)
        top = above;
    else if (canFitBelow)
        top = below;
    else {
        const spaceAbove = targetRect.top - margin;
        const spaceBelow = window.innerHeight - margin - targetRect.bottom;
        top = spaceAbove >= spaceBelow
            ? margin
            : Math.max(margin, window.innerHeight - overlayRect.height - margin);
    }
    const left = clamp(targetRect.left + (targetRect.width - overlayRect.width) / 2, margin, Math.max(margin, window.innerWidth - overlayRect.width - margin));
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
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
    title.textContent = message.title;
    const text = document.createElement("span");
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
    root.append(aside);
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
    let timer = createIdleTimer(showGuide);
    function removeGuide() {
        if (guideOverlay) {
            guideOverlay.remove();
            guideOverlay = null;
            window.removeEventListener("resize", updateGuidePosition);
            window.removeEventListener("scroll", updateGuidePosition, true);
        }
        highlightedAction?.classList.remove("a11y-guide-emphasis");
        highlightedAction = null;
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
        positionGuide(guideOverlay, action?.element ?? null);
    }
    function showGuide() {
        if (destroyed ||
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
        highlightedAction = action.highlightElement ?? target;
        highlightedAction.classList.add("a11y-guide-emphasis");
        guideOverlay = createGuideOverlay(root, guideState.message, () => {
            interactionCount += 1;
            options.onInteractionCount?.(interactionCount);
            removeGuide();
            scheduleGuide();
        });
        positionGuide(guideOverlay, target);
        window.addEventListener("resize", updateGuidePosition);
        window.addEventListener("scroll", updateGuidePosition, true);
        speakText(guideState.message.text, currentProfile.voiceGuidance);
    }
    function scheduleGuide() {
        timer.cancel();
        if (destroyed ||
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
        const previousVoiceGuidance = currentProfile.voiceGuidance;
        currentProfile = validateAccessibilityProfile(input);
        const nextClasses = new Set(accessibilityClasses(currentProfile));
        for (const className of MANAGED_CLASSES) {
            root.classList.toggle(className, nextClasses.has(className));
        }
        if (previousVoiceGuidance && !currentProfile.voiceGuidance)
            cancelSpeech();
        if (!currentProfile.smartGuide)
            removeGuide();
        scheduleGuide();
        return { ...currentProfile };
    }
    function setGuideState(state) {
        guideState = { ...state, message: state.message ? { ...state.message } : null };
        removeGuide();
        scheduleGuide();
    }
    function resetIdleTimer() {
        recordInteraction();
    }
    function speak(text) {
        return speakText(text, currentProfile.voiceGuidance);
    }
    function inspectLayout() {
        const issues = inspectKioskLayout(root, adapter);
        options.onDiagnostics?.(issues);
        return issues;
    }
    root.addEventListener("pointerdown", recordInteraction);
    root.addEventListener("keydown", recordInteraction);
    if (!("PointerEvent" in window))
        root.addEventListener("touchstart", recordInteraction, { passive: true });
    window.addEventListener("scroll", recordScrollInteraction, { passive: true });
    const sdk = {
        version: ACCESSIBILITY_SDK_VERSION,
        get profile() {
            return { ...currentProfile };
        },
        applyProfile,
        setGuideState,
        resetIdleTimer,
        speak,
        inspectLayout,
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            timer.dispose();
            removeGuide();
            root.removeEventListener("pointerdown", recordInteraction);
            root.removeEventListener("keydown", recordInteraction);
            root.removeEventListener("touchstart", recordInteraction);
            window.removeEventListener("scroll", recordScrollInteraction);
            cancelSpeech();
            for (const className of MANAGED_CLASSES) {
                root.classList.toggle(className, originalManagedClasses.has(className));
            }
            if (addedKioskClass)
                root.classList.remove("kiosk");
        },
    };
    return sdk;
}
//# sourceMappingURL=accessibility-sdk.js.map