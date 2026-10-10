import type { AccessibilityAdapter, AccessibilityGuideMessage } from "./adapter.ts";
import { inspectKioskLayout, type AccessibilityDiagnostic } from "./diagnostics.ts";
import { createIdleTimer, smartGuideDelayMs, type GuideState } from "./guide.ts";
import {
  ACCESSIBILITY_SDK_VERSION,
  accessibilityClasses,
  DEFAULT_ACCESSIBILITY_PROFILE,
  validateAccessibilityProfile,
  type AccessibilityProfile,
} from "./profile.ts";
import { cancelSpeech, speakText } from "./speech.ts";

export interface AccessibilitySdkOptions {
  root: HTMLElement;
  adapter: AccessibilityAdapter;
  onInteractionCount?: (count: number) => void;
  onDiagnostics?: (issues: readonly AccessibilityDiagnostic[]) => void;
  onSessionCleanupError?: (error: unknown) => void;
}

export type SessionCleanup = () => void;

export interface AccessibilitySdk {
  readonly version: string;
  readonly profile: AccessibilityProfile;
  applyProfile(input: unknown): AccessibilityProfile;
  setGuideState(state: GuideState): void;
  resetIdleTimer(): void;
  speak(text: string): boolean;
  inspectLayout(): AccessibilityDiagnostic[];
  endSession(): void;
  registerSessionCleanup(cleanup: SessionCleanup): () => void;
  createSessionGuard(): () => boolean;
  destroy(): void;
}

const MANAGED_CLASSES = [
  "a11y-text-large",
  "a11y-text-extra",
  "a11y-controls-large",
  "a11y-high-contrast",
  "a11y-easy-language",
  "a11y-simplified",
  "a11y-bottom-controls",
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function positionGuide(
  overlay: HTMLElement,
  target: HTMLElement | null,
): void {
  if (!target || !target.isConnected) return;
  const targetRect = target.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const margin = 12;
  const gap = 12;
  const above = targetRect.top - overlayRect.height - gap;
  const below = targetRect.bottom + gap;
  const canFitAbove = above >= margin;
  const canFitBelow = below + overlayRect.height <= window.innerHeight - margin;
  let top: number;

  if (canFitAbove) top = above;
  else if (canFitBelow) top = below;
  else {
    const spaceAbove = targetRect.top - margin;
    const spaceBelow = window.innerHeight - margin - targetRect.bottom;
    top = spaceAbove >= spaceBelow
      ? margin
      : Math.max(margin, window.innerHeight - overlayRect.height - margin);
  }

  const left = clamp(
    targetRect.left + (targetRect.width - overlayRect.width) / 2,
    margin,
    Math.max(margin, window.innerWidth - overlayRect.width - margin),
  );
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
}

function createGuideOverlay(
  root: HTMLElement,
  message: AccessibilityGuideMessage,
  onClose: () => void,
): HTMLElement {
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

export function createAccessibilitySdk(options: AccessibilitySdkOptions): AccessibilitySdk {
  const { root, adapter } = options;
  const addedKioskClass = !root.classList.contains("kiosk");
  root.classList.add("kiosk");
  const originalManagedClasses = new Set(
    MANAGED_CLASSES.filter((className) => root.classList.contains(className)),
  );

  let currentProfile: AccessibilityProfile = { ...DEFAULT_ACCESSIBILITY_PROFILE };
  let guideState: GuideState = {
    enabled: false,
    paused: true,
    delaySeconds: 15,
    message: null,
  };
  let guideOverlay: HTMLElement | null = null;
  let highlightedAction: HTMLElement | null = null;
  let interactionCount = 0;
  let lastScrollAt = 0;
  let destroyed = false;
  let sessionGeneration = 0;
  const sessionCleanups = new Set<SessionCleanup>();
  let timer = createIdleTimer(showGuide);

  function removeGuide(): void {
    if (guideOverlay) {
      guideOverlay.remove();
      guideOverlay = null;
      window.removeEventListener("resize", updateGuidePosition);
      window.removeEventListener("scroll", updateGuidePosition, true);
    }
    highlightedAction?.classList.remove("a11y-guide-emphasis");
    highlightedAction = null;
  }

  function findGuideAction(actionId: string | null) {
    if (!actionId) return null;
    return adapter.getActions().find((action) => action.id === actionId) ?? null;
  }

  function updateGuidePosition(): void {
    if (!guideOverlay || !guideState.message?.actionId) return;
    const action = findGuideAction(guideState.message.actionId);
    positionGuide(guideOverlay, action?.element ?? null);
  }

  function showGuide(): void {
    if (
      destroyed ||
      !guideState.enabled ||
      guideState.paused ||
      !guideState.message?.actionId
    ) {
      return;
    }

    const action = findGuideAction(guideState.message.actionId);
    const target = action?.element ?? null;
    if (!action || !target || !root.contains(target)) return;
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

  function scheduleGuide(): void {
    timer.cancel();
    if (
      destroyed ||
      !guideState.enabled ||
      guideState.paused ||
      !guideState.message?.actionId
    ) {
      return;
    }
    timer.reset(smartGuideDelayMs(guideState.delaySeconds));
  }

  function recordInteraction(): void {
    if (destroyed) return;
    interactionCount += 1;
    options.onInteractionCount?.(interactionCount);
    removeGuide();
    scheduleGuide();
  }

  function recordScrollInteraction(): void {
    const now = Date.now();
    if (now - lastScrollAt < 250) return;
    lastScrollAt = now;
    recordInteraction();
  }

  function applyProfile(input: unknown): AccessibilityProfile {
    const previousVoiceGuidance = currentProfile.voiceGuidance;
    currentProfile = validateAccessibilityProfile(input);
    const nextClasses = new Set(accessibilityClasses(currentProfile));
    for (const className of MANAGED_CLASSES) {
      root.classList.toggle(className, nextClasses.has(className));
    }
    if (previousVoiceGuidance && !currentProfile.voiceGuidance) cancelSpeech();
    if (!currentProfile.smartGuide) removeGuide();
    scheduleGuide();
    return { ...currentProfile };
  }

  function setGuideState(state: GuideState): void {
    guideState = { ...state, message: state.message ? { ...state.message } : null };
    removeGuide();
    scheduleGuide();
  }

  function resetIdleTimer(): void {
    recordInteraction();
  }

  function speak(text: string): boolean {
    return speakText(text, currentProfile.voiceGuidance);
  }

  function inspectLayout(): AccessibilityDiagnostic[] {
    const issues = inspectKioskLayout(root, adapter);
    options.onDiagnostics?.(issues);
    return issues;
  }

  function endSession(): void {
    sessionGeneration += 1;
    timer.cancel();
    for (const cleanup of [...sessionCleanups]) {
      try {
        cleanup();
      } catch (error) {
        try {
          options.onSessionCleanupError?.(error);
        } catch {
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
    removeGuide();
    cancelSpeech();
    applyProfile(DEFAULT_ACCESSIBILITY_PROFILE);
    interactionCount = 0;
    options.onInteractionCount?.(0);
  }

  function registerSessionCleanup(cleanup: SessionCleanup): () => void {
    if (destroyed) {
      cleanup();
      return () => undefined;
    }
    sessionCleanups.add(cleanup);
    return () => sessionCleanups.delete(cleanup);
  }

  function createSessionGuard(): () => boolean {
    const generation = sessionGeneration;
    return () => !destroyed && sessionGeneration === generation;
  }

  root.addEventListener("pointerdown", recordInteraction);
  root.addEventListener("keydown", recordInteraction);
  if (!("PointerEvent" in window)) root.addEventListener("touchstart", recordInteraction, { passive: true });
  window.addEventListener("scroll", recordScrollInteraction, { passive: true });

  const sdk: AccessibilitySdk = {
    version: ACCESSIBILITY_SDK_VERSION,
    get profile() {
      return { ...currentProfile };
    },
    applyProfile,
    setGuideState,
    resetIdleTimer,
    speak,
    inspectLayout,
    endSession,
    registerSessionCleanup,
    createSessionGuard,
    destroy() {
      if (destroyed) return;
      endSession();
      destroyed = true;
      timer.dispose();
      removeGuide();
      root.removeEventListener("pointerdown", recordInteraction);
      root.removeEventListener("keydown", recordInteraction);
      root.removeEventListener("touchstart", recordInteraction);
      window.removeEventListener("scroll", recordScrollInteraction);
      for (const className of MANAGED_CLASSES) {
        root.classList.toggle(className, originalManagedClasses.has(className));
      }
      if (addedKioskClass) root.classList.remove("kiosk");
      sessionCleanups.clear();
    },
  };

  return sdk;
}
