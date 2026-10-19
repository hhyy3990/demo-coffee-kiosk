import type { AccessibilityAdapter, AccessibilityGuideMessage, KioskLayoutRegions } from "./adapter.ts";
import {
  createBottomViewportController,
  type BottomViewportConfig,
} from "./bottom-viewport.ts";
import { inspectKioskLayout, type AccessibilityDiagnostic } from "./diagnostics.ts";
import {
  createLayoutEnhancer,
  type LayoutCorrectionResult,
} from "./layout-enhancements.ts";
import { createScrollGuidance } from "./scroll-guidance.ts";
import { createIdleTimer, smartGuideDelayMs, type GuideState } from "./guide.ts";
import {
  ACCESSIBILITY_SDK_VERSION,
  accessibilityClasses,
  DEFAULT_ACCESSIBILITY_PROFILE,
  validateAccessibilityProfile,
  type AccessibilityProfile,
} from "./profile.ts";
import { cancelSpeech, speakText } from "./speech.ts";
import { createScreenChangeController } from "./screen-change.ts";
import { syncQrEntryDockViewportMode } from "./qr-entry-dock.ts";
import {
  createCompletionController,
  type CompletionReturnCallback,
  type CompletionState,
} from "./completion.ts";

export interface AccessibilitySdkOptions {
  root: HTMLElement;
  adapter: AccessibilityAdapter;
  /** Explicit opt-in; never inferred from the central QR profile. */
  viewportMode?: BottomViewportConfig;
  onInteractionCount?: (count: number) => void;
  onDiagnostics?: (issues: readonly AccessibilityDiagnostic[]) => void;
  onSessionCleanupError?: (error: unknown) => void;
}

export interface EasyLanguageExplanation {
  title: string;
  text: string;
}

export interface EasyLanguageState {
  /** Host-owned current business step ID. */
  stepId: string;
  explanations: readonly EasyLanguageExplanation[];
}

export type SessionCleanup = () => void;

export interface AccessibilitySdk {
  readonly version: string;
  readonly profile: AccessibilityProfile;
  applyProfile(input: unknown): AccessibilityProfile;
  /** Notify only when the host commits a different business screen. */
  notifyScreenChange(screenId: string): boolean;
  setViewportMode(config: BottomViewportConfig | null): boolean;
  setGuideState(state: GuideState): void;
  /** Supply host-authored plain-language help; the SDK owns paging and presentation. */
  setEasyLanguageState(state: EasyLanguageState): void;
  beginCompletion(onReturn: CompletionReturnCallback): void;
  extendCompletion(): boolean;
  cancelCompletion(): void;
  finishCompletion(): Promise<void>;
  subscribeCompletion(listener: (state: CompletionState) => void): () => void;
  readonly completionState: CompletionState;
  resetIdleTimer(): void;
  speak(text: string): boolean;
  inspectLayout(): AccessibilityDiagnostic[];
  correctLayout(): LayoutCorrectionResult[];
  getLastLayoutCorrections(): LayoutCorrectionResult[];
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
  "a11y-bottom-controls",
] as const;

export const GUIDE_AUTO_DISMISS_MS = 10_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function getVisibleClientRect(
  element: HTMLElement,
  viewportWidth = document.documentElement?.clientWidth || window.innerWidth,
  viewportHeight = document.documentElement?.clientHeight || window.innerHeight,
): { left: number; top: number; right: number; bottom: number } | null {
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
    if (right <= left || bottom <= top) return null;
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function getGuideProtectedActions(regions?: KioskLayoutRegions): HTMLElement[] {
  const markedActions = typeof document.querySelectorAll === "function"
    ? Array.from(document.querySelectorAll<HTMLElement>('[data-a11y-primary="true"]'))
    : [];
  return [...new Set([
    ...(regions?.primaryActions ?? []).map(({ element }) => element),
    ...markedActions,
  ])];
}

function primaryActionsRemainHitTestable(
  overlay: HTMLElement,
  regions?: KioskLayoutRegions,
): boolean {
  const document = overlay.ownerDocument;
  const view = document?.defaultView;
  const hitTest = document?.elementFromPoint?.bind(document);
  if (!view || !hitTest) return true;
  const overlayRect = overlay.getBoundingClientRect();
  return getGuideProtectedActions(regions).every((element) => {
    if (!element.isConnected || ("disabled" in element && Boolean((element as HTMLButtonElement).disabled))) return true;
    if (getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden") return true;
    const rect = getVisibleClientRect(element, view.innerWidth, view.innerHeight);
    if (!rect) return true;
    const left = Math.max(rect.left, overlayRect.left);
    const right = Math.min(rect.right, overlayRect.right);
    const top = Math.max(rect.top, overlayRect.top);
    const bottom = Math.min(rect.bottom, overlayRect.bottom);
    if (right <= left || bottom <= top) return true;
    const x = left + (right - left) / 2;
    const y = top + (bottom - top) / 2;
    const hit = hitTest(x, y);
    return hit === element || element.contains(hit);
  });
}

function positionGuide(
  overlay: HTMLElement,
  target: HTMLElement | null,
  root?: HTMLElement,
  regions?: KioskLayoutRegions,
): boolean {
  if (!target || !target.isConnected) return false;
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
  } else {
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
    const qrDocks = Array.from(document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]"));
    const controls = [...(regions?.bottomControls ?? []), ...qrDocks].filter((el) =>
      el.isConnected && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none",
    );
    const safeBottom = controls.reduce((edge, el) =>
      Math.min(edge, el.getBoundingClientRect().top), Math.min(vh, shell.top)) - 8;
    // Anchor the panel to the top of the non-scrolling band. Long copy is
    // paginated so changing pages cannot shift this stable anchor.
    const safeTop = 8;
    const availableHeight = safeBottom - safeTop;
    if (availableHeight < 72) return false;
    overlay.style.position = "fixed";
    overlay.style.left = `${Math.max(12, (vw - Math.min(500, vw - 24)) / 2)}px`;
    overlay.style.top = `${safeTop}px`;
    overlay.style.bottom = "auto";
    overlay.style.width = `min(500px, calc(100vw - 24px))`;
    // safeBottom already leaves an 8px clearance to fixed controls; use the
    // full safe band so fractional text line boxes are not clipped by a second inset.
    overlay.style.maxHeight = `${Math.max(0, availableHeight)}px`;
    overlay.style.overflow = "hidden";
    overlay.style.visibility = "hidden";
    const height = overlay.getBoundingClientRect().height;
    const action = target.getBoundingClientRect();
    const minimum = safeTop;
    const maximum = safeTop;
    const positions = [action.top - height - 12, action.bottom + 12];
    const isMovingScrollContent = (element: HTMLElement) => {
      if (!scrollArea || typeof getComputedStyle !== "function") return false;
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
      const rect = getVisibleClientRect(element, vw, vh)!;
      return [rect.top - height - 8, rect.bottom + 8]
        .map((candidate) => clamp(candidate, minimum, maximum));
    });
    const fits = positions.map((candidate) => clamp(candidate, minimum, maximum));
    fits.push(minimum, maximum, minimum + (maximum - minimum) / 2);
    const candidates = [...new Set([
      ...(Number.isFinite(previousTop) ? [clamp(previousTop, minimum, maximum)] : []),
      minimum,
      ...fits,
      ...obstacleEdges,
    ].filter(Number.isFinite))];
    const overlapsAt = (candidate: number, element: HTMLElement) => {
      const rect = getVisibleClientRect(element, vw, vh);
      if (!rect) return false;
      return 12 < rect.right && vw - 12 > rect.left &&
        candidate < rect.bottom && candidate + height > rect.top;
    };
    const top = candidates.find((candidate) =>
      !obstacles.some((element) => overlapsAt(candidate, element)),
    );
    if (top === undefined || maximum < minimum) return false;
    overlay.style.top = `${top}px`;
    overlay.style.visibility = "visible";
    if (!primaryActionsRemainHitTestable(overlay, regions)) {
      overlay.style.visibility = "hidden";
      return false;
    }
    return true;
  }
  const targetRect = target.getBoundingClientRect();
  let overlayRect = overlay.getBoundingClientRect();
  const margin = 12;
  const gap = 12;
  const above = targetRect.top - overlayRect.height - gap;
  const below = targetRect.bottom + gap;
  const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
  const fixedRegions = [
    ...(regions?.bottomControls ?? []),
    ...(typeof document.querySelectorAll === "function"
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]"))
      : []),
  ].filter((element) => element.isConnected && getComputedStyle(element).display !== "none");
  const safeBottom = fixedRegions.reduce((edge, element) =>
    Math.min(edge, element.getBoundingClientRect().top), viewportHeight) - 8;
  overlay.style.maxHeight = `${Math.max(0, Math.min(viewportHeight - margin * 2, safeBottom - margin))}px`;
  overlay.style.overflow = "hidden";
  overlayRect = overlay.getBoundingClientRect();
  const maxTop = Math.max(margin, viewportHeight - overlayRect.height - margin);
  const clampToViewport = (value: number) => clamp(value, margin, maxTop);
  const scrollArea = regions?.scrollArea && root?.contains(regions.scrollArea)
    ? regions.scrollArea
    : null;
  const isScrollMoving = (element: HTMLElement) => {
    if (!scrollArea || typeof getComputedStyle !== "function") return false;
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
    margin,
    ...preferred,
    ...(targetIsViewportStable ? [clampToViewport(above), clampToViewport(below)] : []),
    margin,
    maxTop,
  ];
  const previousLeft = Number.parseFloat(overlay.style.left);
  const left = targetIsViewportStable
    ? clamp(
      targetRect.left + (targetRect.width - overlayRect.width) / 2,
      margin,
      Math.max(margin, viewportWidth - overlayRect.width - margin),
    )
    : clamp(
      Number.isFinite(previousLeft) ? previousLeft : margin,
      margin,
      Math.max(margin, viewportWidth - overlayRect.width - margin),
    );
  const preserveScrollPosition = Number.isFinite(previousTop);
  const obstacles = [
    ...(targetIsViewportStable ? [target] : []),
    ...getGuideProtectedActions(regions).filter((element) =>
      !preserveScrollPosition || !isScrollMoving(element)),
    ...(regions?.guidanceAvoidAreas ?? []).filter((element) =>
      !preserveScrollPosition || !isScrollMoving(element)),
    ...(regions?.viewportOverlays ?? []),
    ...(regions?.bottomControls ?? []),
    ...(typeof document.querySelectorAll === "function"
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-a11y-qr-entry-dock]"))
      : []),
  ].filter((element) => element !== overlay && element.isConnected &&
    getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" &&
    getVisibleClientRect(element, viewportWidth, viewportHeight) !== null);
  const obstacleEdges = obstacles.flatMap((element) => {
    const rect = getVisibleClientRect(element, viewportWidth, viewportHeight)!;
    return [clampToViewport(rect.top - overlayRect.height - margin), clampToViewport(rect.bottom + margin)];
  });
  const overlap = (top: number) => obstacles.reduce((sum, element) => {
    const rect = getVisibleClientRect(element, viewportWidth, viewportHeight);
    if (!rect) return sum;
    return sum + Math.max(0, Math.min(left + overlayRect.width, rect.right) - Math.max(left, rect.left)) *
      Math.max(0, Math.min(top + overlayRect.height, rect.bottom) - Math.max(top, rect.top));
  }, 0);
  const uniqueCandidates = [...new Set([...candidates, ...obstacleEdges])];
  const top = uniqueCandidates.find((candidate) => overlap(candidate) === 0);
  if (top === undefined) return false;
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.visibility = "visible";
  if (!primaryActionsRemainHitTestable(overlay, regions)) {
    overlay.style.visibility = "hidden";
    return false;
  }
  return true;
}

function createGuideOverlay(
  root: HTMLElement,
  handlers: {
    onClose: () => void;
    onPrevious: () => void;
    onNext: () => void;
  },
): HTMLElement {
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

  header.append(icon, countdown, title, close);
  aside.append(header, copy, pager);
  const slot = !root.classList.contains("a11y-bottom-viewport-poc-shell") &&
    typeof root.querySelector === "function"
    ? root.querySelector<HTMLElement>(".a11y-guidance-slot")
    : null;
  (slot ?? root).append(aside);
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
  let dismissedGuideIdentity: string | null = null;
  let guideOverlay: HTMLElement | null = null;
  let guideValidationFrame = 0;
  let guidePositionFrame = 0;
  let nextItemRefreshFrame = 0;
  let highlightedAction: HTMLElement | null = null;
  let easyLanguageState: EasyLanguageState | null = null;
  let easyLanguageSource: EasyLanguageExplanation[] = [];
  let easyLanguageIndex = 0;
  let fittingEasyPages = false;
  const warnedEasyText = new Set<string>();
  let smartGuideVisible = false;
  let smartGuidePages: string[] = [];
  let smartGuidePageIndex = 0;
  let guideDeadline = 0;
  let guideCountdownTimer: ReturnType<typeof setTimeout> | null = null;
  let smartGuidePageTimer: ReturnType<typeof setTimeout> | null = null;
  let interactionCount = 0;
  let lastScrollAt = 0;
  let destroyed = false;
  let sessionEnded = false;
  let sessionGeneration = 0;
  let completionScreenId: string | null = null;
  let completionActive = false;
  const sessionCleanups = new Set<SessionCleanup>();
  type HorizontalDirection = "backward" | "forward";
  type NavigationState = {
    seen: Set<HorizontalDirection>;
    available: Set<HorizontalDirection>;
    activeButton?: HTMLElement;
    activeDirection?: HorizontalDirection;
    timer?: number;
  };
  const navigationStates = new Map<string, NavigationState>();
  const emphasizedNextButtons = new Set<HTMLElement>();
  const nextItemObserver = typeof MutationObserver === "undefined"
    ? null
    : new MutationObserver((mutations) => {
      const hostLayoutChanged = mutations.some(({ target, type, attributeName }) => {
        if (guideOverlay?.contains(target)) return type === "childList";
        // SDK emphasis classes are presentation-only. Observing them here
        // makes the observer react to its own button highlighting.
        if (type === "attributes" && attributeName === "class" &&
            target instanceof HTMLElement &&
            (target.classList.contains("a11y-next-item-emphasis") ||
             target.classList.contains("a11y-guide-emphasis"))) return false;
        return true;
      });
      if (!hostLayoutChanged || nextItemRefreshFrame) return;
      nextItemRefreshFrame = window.requestAnimationFrame(() => {
        nextItemRefreshFrame = 0;
        if (destroyed) return;
        refreshNextItemButtons();
        if (guideOverlay) scheduleGuidePosition();
      });
    });
  let timer = createIdleTimer(showGuide);
  let guideDismissTimer: ReturnType<typeof setTimeout> | null = null;
  const layoutEnhancer = createLayoutEnhancer(root, adapter, () => currentProfile);
  const menuHint = createScrollGuidance(root, adapter);
  const bottomViewport = createBottomViewportController(root, adapter);
  const screenChange = createScreenChangeController(root, adapter, () => bottomViewport.refresh());
  const completion = createCompletionController((state) => { completionActive = state.active; });

  function effectiveViewportMode(screenId = adapter.getSnapshot().screenId) {
    if (currentProfile.viewportMode) return currentProfile.viewportMode;
    if (currentProfile.easyLanguage && typeof root.getBoundingClientRect === "function") {
      return { mode: "bottom" as const, heightPercent: 80 as const };
    }
    return null;
  }

  function currentEasyExplanation(): EasyLanguageExplanation | null {
    if (!currentProfile.easyLanguage || !easyLanguageState ||
        easyLanguageState.explanations.length === 0 || sessionEnded) return null;
    return easyLanguageState.explanations[easyLanguageIndex] ?? null;
  }

  function currentEasyLanguageOffset(): number {
    if (!easyLanguageState) return 0;
    return easyLanguageState.explanations
      .slice(0, easyLanguageIndex)
      .reduce((offset, explanation) => offset + explanation.text.length, 0);
  }

  function findEasyLanguagePageAtOffset(
    explanations: readonly EasyLanguageExplanation[],
    offset: number,
  ): number {
    let pageStart = 0;
    for (const [index, explanation] of explanations.entries()) {
      if (offset < pageStart + explanation.text.length) return index;
      pageStart += explanation.text.length;
    }
    return Math.max(0, explanations.length - 1);
  }

  function currentGuidanceMessage(): AccessibilityGuideMessage | null {
    if (smartGuideVisible && guideState.message) {
      return {
        ...guideState.message,
        text: smartGuidePages[smartGuidePageIndex] ?? guideState.message.text,
      };
    }
    const explanation = currentEasyExplanation();
    return explanation ? { ...explanation, actionId: null } : null;
  }

  function fitSmartGuidePages(text: string): { pages: string[]; requiredPages: number } {
    const overlay = guideOverlay;
    const copy = overlay?.querySelector<HTMLElement>(".a11y-guide-copy");
    const header = overlay?.querySelector<HTMLElement>(".a11y-guide-header");
    const liveText = overlay?.querySelector<HTMLElement>("[data-a11y-guide-text]");
    if (!overlay || !copy || !header || !liveText || copy.clientWidth < 40 ||
        typeof getComputedStyle !== "function") {
      return { pages: [text], requiredPages: 1 };
    }

    const panelStyle = getComputedStyle(overlay);
    const maxHeight = Number.parseFloat(overlay.style.maxHeight) || Math.max(120, innerHeight - 24);
    const padding = (Number.parseFloat(panelStyle.paddingTop) || 0) +
      (Number.parseFloat(panelStyle.paddingBottom) || 0);
    const borders = (Number.parseFloat(panelStyle.borderTopWidth) || 0) +
      (Number.parseFloat(panelStyle.borderBottomWidth) || 0);
    const gap = Number.parseFloat(panelStyle.rowGap) || 0;
    const textHeight = Math.max(0, maxHeight - header.getBoundingClientRect().height -
      padding - borders - gap);
    const textStyle = getComputedStyle(liveText);
    const probe = document.createElement("span");
    probe.className = "a11y-guide-copy";
    Object.assign(probe.style, {
      position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
      display: "block", width: `${copy.clientWidth}px`, maxHeight: "none",
      overflow: "visible", lineHeight: textStyle.lineHeight, fontSize: textStyle.fontSize,
      fontFamily: textStyle.fontFamily, fontWeight: textStyle.fontWeight,
      letterSpacing: textStyle.letterSpacing, overflowWrap: textStyle.overflowWrap,
      wordBreak: textStyle.wordBreak,
    });
    document.body.append(probe);
    const measure = (value: string) => {
      probe.textContent = value;
      return Math.max(probe.getBoundingClientRect().height, probe.scrollHeight);
    };
    try {
      if (measure(text) <= textHeight) return { pages: [text], requiredPages: 1 };
      const candidates: { index: number; sentence: boolean }[] = [];
      for (const match of text.matchAll(/[.!?。！？]+(?=\s|$)|\s+/gu)) {
        const index = match.index + match[0].length;
        if (index > 0 && index < text.length) {
          candidates.push({
            index,
            sentence: /^[.!?。！？]+$/u.test(match[0]),
          });
        }
      }
      for (const sentenceOnly of [true, false]) {
        const fitting = candidates
          .filter((candidate) => !sentenceOnly || candidate.sentence)
          .map((candidate) => ({
            candidate,
            firstHeight: measure(text.slice(0, candidate.index)),
            secondHeight: measure(text.slice(candidate.index)),
          }))
          .filter((item) => item.firstHeight <= textHeight && item.secondHeight <= textHeight)
          .sort((a, b) => Math.abs(a.firstHeight - a.secondHeight) -
            Math.abs(b.firstHeight - b.secondHeight));
        if (fitting.length) {
          const split = fitting[0].candidate.index;
          return { pages: [text.slice(0, split), text.slice(split)], requiredPages: 2 };
        }
      }

      let requiredPages = 1;
      let pageText = "";
      const tokens = text.match(/\s+|[^\s]+/gu) ?? [text];
      for (const token of tokens) {
        if (measure(token) > textHeight) {
          for (const grapheme of Array.from(token)) {
            if (measure(pageText + grapheme) <= textHeight || !pageText) {
              pageText += grapheme;
            } else {
              requiredPages += 1;
              pageText = grapheme;
            }
          }
        } else if (measure(pageText + token) <= textHeight || !pageText) {
          pageText += token;
        } else {
          requiredPages += 1;
          pageText = token;
        }
      }
      return { pages: [], requiredPages: Math.max(3, requiredPages) };
    } finally {
      probe.remove();
    }
  }

  function fitEasyLanguagePages(): EasyLanguageExplanation[] {
    const currentPages = [...(easyLanguageState?.explanations ?? easyLanguageSource)];
    if (!guideOverlay || !easyLanguageSource.length || typeof getComputedStyle !== "function") {
      return currentPages;
    }
    const copy = guideOverlay.querySelector<HTMLElement>(".a11y-guide-copy");
    const header = guideOverlay.querySelector<HTMLElement>(".a11y-guide-header");
    const pager = guideOverlay.querySelector<HTMLElement>(".a11y-guide-pager");
    if (!copy || !header || !pager || copy.clientWidth < 40) return currentPages;
    const maxPanelHeight = Number.parseFloat(guideOverlay.style.maxHeight) ||
      Math.max(120, innerHeight - 24);
    // Reclaim the separate pager row while the remaining body area cannot
    // hold two readable lines; this includes the explicit 70% short-mobile case.
    const tight = maxPanelHeight < 160;
    guideOverlay.classList.toggle("a11y-guide-tight", tight);
    if (tight && pager.parentElement !== header) header.append(pager);
    else if (!tight && pager.parentElement !== guideOverlay) copy.after(pager);
    const pagerWasHidden = pager.hidden;
    if (tight) pager.hidden = false;
    const measuredHeaderHeight = header.getBoundingClientRect().height;
    pager.hidden = pagerWasHidden;
    const panelStyle = getComputedStyle(guideOverlay);
    const verticalPadding = (Number.parseFloat(panelStyle.paddingTop) || 0) +
      (Number.parseFloat(panelStyle.paddingBottom) || 0);
    const verticalBorder = (Number.parseFloat(panelStyle.borderTopWidth) || 0) +
      (Number.parseFloat(panelStyle.borderBottomWidth) || 0);
    const measuredGap = Number.parseFloat(panelStyle.rowGap);
    const gap = Number.isFinite(measuredGap) ? measuredGap : 4;
    const pagerHeight = tight ? 0 : 44;
    // Reserve one CSS pixel for fractional line-box and border rounding so
    // text that barely exceeds the actual clipped area is paged, not truncated.
    const textHeight = Math.max(0, maxPanelHeight - measuredHeaderHeight -
      pagerHeight - verticalPadding - verticalBorder - gap * 2 - 1);
    const liveText = copy.querySelector<HTMLElement>("[data-a11y-guide-text]");
    if (!liveText) return currentPages;
    const textStyle = getComputedStyle(liveText);
    const probe = document.createElement("span");
    probe.className = "a11y-guide-copy";
    Object.assign(probe.style, {
      position: "fixed", left: "-10000px", top: "0", visibility: "hidden",
      display: "block", width: `${copy.clientWidth}px`, maxHeight: "none",
      overflow: "visible", lineHeight: textStyle.lineHeight, fontSize: textStyle.fontSize,
      fontFamily: textStyle.fontFamily, fontWeight: textStyle.fontWeight,
      letterSpacing: textStyle.letterSpacing, overflowWrap: textStyle.overflowWrap,
      wordBreak: textStyle.wordBreak,
    });
    document.body.append(probe);
    const measure = (value: string) => {
      probe.textContent = value;
      return probe.getBoundingClientRect().height;
    };
    const canFitOneLine = measure("가") <= textHeight + 0.5;
    const splitOversize = (sentence: string) => {
      const tokens = sentence.match(/\s+|[^\s]+/gu) ?? [sentence];
      const chunks: string[] = [];
      let chunk = "";
      for (const token of tokens) {
        if (measure(token) > textHeight) {
          if (chunk) chunks.push(chunk);
          chunks.push(token);
          chunk = "";
        } else if (measure(chunk + token) <= textHeight || !chunk) {
          chunk += token;
        } else {
          chunks.push(chunk);
          chunk = token;
        }
      }
      if (chunk) chunks.push(chunk);
      if (chunks.length > 1 && measure(chunks.at(-1)!) < textHeight * 0.6) {
        const previous = chunks.at(-2)!;
        const trailingWord = /(\s+\S+)\s*$/u.exec(previous);
        if (trailingWord?.index !== undefined) {
          const balancedPrevious = previous.slice(0, trailingWord.index);
          const balancedLast = previous.slice(trailingWord.index) + chunks.at(-1)!;
          if (balancedPrevious && measure(balancedPrevious) <= textHeight &&
              measure(balancedLast) <= textHeight) {
            chunks[chunks.length - 2] = balancedPrevious;
            chunks[chunks.length - 1] = balancedLast;
          }
        }
      }
      return chunks;
    };
    const fitted: EasyLanguageExplanation[] = [];
    for (const explanation of easyLanguageSource) {
      const originalHeight = measure(explanation.text);
      const sentences = explanation.text.match(/[^.!?。！？]+[.!?。！？]*/gu) ?? [explanation.text];
      const pieces: string[] = [];
      let piece = "";
      const appendSplitPieces = (splitPieces: readonly string[]) => {
        let leadingWhitespace = "";
        for (const splitPiece of splitPieces) {
          if (/^\s+$/u.test(splitPiece)) {
            if (pieces.length) pieces[pieces.length - 1] += splitPiece;
            else leadingWhitespace += splitPiece;
          } else {
            pieces.push(leadingWhitespace + splitPiece);
            leadingWhitespace = "";
          }
        }
        if (leadingWhitespace) {
          if (pieces.length) pieces[pieces.length - 1] += leadingWhitespace;
          else pieces.push(leadingWhitespace);
        }
      };
      for (const sentence of sentences) {
        if (measure(piece + sentence) <= textHeight) piece += sentence;
        else {
          if (piece) pieces.push(piece);
          piece = "";
          if (measure(sentence) <= textHeight) piece = sentence;
          else if (canFitOneLine) appendSplitPieces(splitOversize(sentence));
          else pieces.push(sentence);
        }
      }
      if (piece) {
        if (/^\s+$/u.test(piece) && pieces.length) pieces[pieces.length - 1] += piece;
        else pieces.push(piece);
      }
      const warningKey = `${easyLanguageState?.stepId ?? ""}:${easyLanguageSource.indexOf(explanation)}:${explanation.text.length}`;
      if ((explanation.text.length > 240 || originalHeight > textHeight) &&
          !warnedEasyText.has(warningKey) && typeof console !== "undefined") {
        warnedEasyText.add(warningKey);
        const oversizedToken = sentences.some((sentence) =>
          (sentence.match(/\s+|[^\s]+/gu) ?? [sentence]).some((token) =>
            !/^\s+$/u.test(token) && measure(token) > textHeight),
        );
        console.warn(`[kiosk-accessibility-sdk] 쉬운 말 설명의 렌더 높이 ${Math.ceil(originalHeight)}px, 사용 가능 높이 ${Math.floor(textHeight)}px, 한 줄 최소 높이 ${Math.ceil(measure("가"))}px입니다.${!canFitOneLine ? " 한 줄도 들어가지 않아 글자 단위 페이지 분할을 중단했습니다." : oversizedToken ? " 단어가 사용 가능 높이를 넘어 단어를 분할하지 않았습니다." : pieces.length > 1 ? ` 내용은 ${pieces.length}페이지로 나눴습니다.` : ""} 호스트에서 문장별 설명으로 전달하는 것을 권장합니다.`);
      }
      fitted.push(...pieces.map((text) => ({ title: explanation.title, text })));
    }
    probe.remove();
    return fitted.length ? fitted : easyLanguageSource;
  }

  function renderGuidancePanel(): void {
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
          dismissedGuideIdentity = guideIdentity(guideState);
          timer.cancel();
          finishSmartGuide();
        },
        onPrevious: () => {
          if (easyLanguageIndex > 0) easyLanguageIndex -= 1;
          renderGuidancePanel();
        },
        onNext: () => {
          const count = easyLanguageState?.explanations.length ?? 0;
          if (easyLanguageIndex < count - 1) easyLanguageIndex += 1;
          renderGuidancePanel();
        },
      });
      window.addEventListener("resize", scheduleGuidePosition, { passive: true });
      window.addEventListener("scroll", scheduleGuidePosition, { capture: true, passive: true });
    }
    const title = guideOverlay.querySelector<HTMLElement>("[data-a11y-guide-title]");
    const copy = guideOverlay.querySelector<HTMLElement>(".a11y-guide-copy");
    const text = guideOverlay.querySelector<HTMLElement>("[data-a11y-guide-text]");
    const countdown = guideOverlay.querySelector<HTMLElement>("[data-a11y-guide-countdown]");
    const pager = guideOverlay.querySelector<HTMLElement>("[data-a11y-guide-pager]");
    const previous = guideOverlay.querySelector<HTMLButtonElement>("[data-a11y-guide-previous]");
    const next = guideOverlay.querySelector<HTMLButtonElement>("[data-a11y-guide-next]");
    const page = guideOverlay.querySelector<HTMLElement>("[data-a11y-guide-page]");
    const close = guideOverlay.querySelector<HTMLButtonElement>(".a11y-guide-close");
    if (title) title.textContent = message.title;
    if (text) text.textContent = message.text;
    if (countdown) {
      const remaining = smartGuideVisible ? Math.max(0, Math.ceil((guideDeadline - Date.now()) / 1000)) : 0;
      countdown.textContent = smartGuideVisible ? `${remaining}초` : "";
      countdown.hidden = !smartGuideVisible;
    }
    const count = smartGuideVisible || !currentEasyExplanation()
      ? 0
      : easyLanguageState?.explanations.length ?? 0;
    if (pager) pager.hidden = smartGuideVisible || count < 2;
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
    if (close) close.hidden = !smartGuideVisible;
    guideOverlay.classList.toggle("a11y-guide-smart", smartGuideVisible);
    guideOverlay.classList.toggle(
      "a11y-guide-smart-two-page",
      smartGuideVisible && smartGuidePages.length === 2,
    );
    if (text && copy && !smartGuideVisible) {
      copy.style.minHeight = "0";
      copy.style.minHeight = `${copy.scrollHeight}px`;
    }
    updateGuidePosition();
    if (!smartGuideVisible && easyLanguageState && !fittingEasyPages) {
      const readingOffset = currentEasyLanguageOffset();
      fittingEasyPages = true;
      try {
        const pages = fitEasyLanguagePages();
        const changed = pages.length !== easyLanguageState.explanations.length ||
          pages.some((page, index) => page.text !== easyLanguageState?.explanations[index]?.text);
        if (changed) {
          easyLanguageState = { ...easyLanguageState, explanations: pages };
          easyLanguageIndex = findEasyLanguagePageAtOffset(pages, readingOffset);
          // The pager's measured reservation is independent of its current visibility.
          // Keep fitting guarded while redrawing the fitted copy to avoid recursive refits.
          renderGuidancePanel();
        }
      } finally {
        fittingEasyPages = false;
      }
    }
  }

  function refreshNextItemButtons(): void {
    if (sessionEnded || destroyed) return;
    if (typeof root.querySelectorAll !== "function") return;
    const regions = adapter.getLayoutRegions();
    const candidates = new Map<HTMLElement, { list: HTMLElement; direction: HorizontalDirection; key: string }>();
    const add = (button: HTMLElement | null | undefined, list: HTMLElement, direction: HorizontalDirection, key: string) => {
      if (!button || !root.contains(button) || !root.contains(list) ||
          (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true") return;
      candidates.set(button, { list, direction, key });
    };
    for (const [index, nav] of (regions.horizontalNavigation ?? []).entries()) {
      const key = nav.list.id || `semantic-list-${index}`;
      const max = Math.max(0, nav.list.scrollWidth - nav.list.clientWidth);
      if (max <= 1) continue;
      add(nav.previousButton, nav.list, "backward", key);
      add(nav.nextButton, nav.list, "forward", key);
    }
    const listTerms = "(?:category|menu|item|list|카테고리|메뉴|항목|목록)";
    for (const button of root.querySelectorAll<HTMLElement>("button[aria-label][aria-controls], [role='button'][aria-label][aria-controls]")) {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.toLocaleLowerCase();
      const direction: HorizontalDirection | null =
        new RegExp(`(?:next|다음).*${listTerms}|${listTerms}.*(?:next|다음)`, "i").test(label) ? "forward" :
        new RegExp(`(?:previous|prev|back|이전).*${listTerms}|${listTerms}.*(?:previous|prev|back|이전)`, "i").test(label) ? "backward" :
        null;
      if (!direction || (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true") continue;
      const list = button.getAttribute("aria-controls")?.split(/\s+/)
        .map((id) => document.getElementById(id))
        .find((element): element is HTMLElement => element instanceof HTMLElement && root.contains(element));
      if (!list || list.scrollWidth <= list.clientWidth + 1) continue;
      add(button, list, direction, list.id || "controlled-horizontal-list");
    }
    const activeKeys = new Set([...candidates.values()].map((item) => item.key));
    for (const button of emphasizedNextButtons) {
      if (![...candidates.keys()].includes(button)) button.classList.remove("a11y-next-item-emphasis");
    }
    emphasizedNextButtons.clear();
    for (const [button, candidate] of candidates) {
      const state = navigationStates.get(candidate.key) ?? {
        seen: new Set<HorizontalDirection>(),
        available: new Set<HorizontalDirection>(),
      };
      navigationStates.set(candidate.key, state);
      const max = Math.max(0, candidate.list.scrollWidth - candidate.list.clientWidth);
      const available = new Set<HorizontalDirection>();
      if (candidate.list.scrollLeft > 1) available.add("backward");
      if (max - candidate.list.scrollLeft > 1) available.add("forward");
      if (state.activeDirection && !available.has(state.activeDirection)) stopNavigationEmphasis(state);
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
          if (matching) startNavigationEmphasis(state, matching[0], direction);
        }
      }
      if (state.activeButton === button && state.activeDirection === candidate.direction && available.has(candidate.direction)) {
        button.classList.add("a11y-next-item-emphasis");
        emphasizedNextButtons.add(button);
      }
    }
    for (const key of navigationStates.keys()) if (!activeKeys.has(key)) stopNavigationEmphasis(navigationStates.get(key)!);
  }

  function stopNavigationEmphasis(state: NavigationState): void {
    if (state.timer !== undefined) window.clearTimeout(state.timer);
    state.timer = undefined;
    state.activeButton?.classList.remove("a11y-next-item-emphasis");
    state.activeButton = undefined;
    state.activeDirection = undefined;
  }

  function startNavigationEmphasis(state: NavigationState, button: HTMLElement, direction: HorizontalDirection): void {
    if (state.activeButton) return;
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

  function onNavigationClick(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(
      ".a11y-next-item-emphasis, button[aria-controls], [role='button'][aria-controls]",
    ) : null;
    if (!target) return;
    const regions = adapter.getLayoutRegions();
    const semantic = (regions.horizontalNavigation ?? []).find((nav) =>
      nav.previousButton === target || nav.nextButton === target,
    );
    const listId = semantic?.list.id || target.getAttribute("aria-controls")?.split(/\s+/).find((id) =>
      document.getElementById(id) && root.contains(document.getElementById(id)),
    ) || "controlled-horizontal-list";
    const state = navigationStates.get(listId);
    if (!state) return;
    const name = `${target.getAttribute("aria-label") ?? ""} ${target.textContent ?? ""}`;
    const direction = semantic
      ? semantic.previousButton === target ? "backward" : "forward"
      : /(?:previous|prev|back|이전).*(?:category|menu|item|list|카테고리|메뉴|항목|목록)|(?:category|menu|item|list|카테고리|메뉴|항목|목록).*(?:previous|prev|back|이전)/i.test(name)
        ? "backward"
        : /(?:next|다음).*(?:category|menu|item|list|카테고리|메뉴|항목|목록)|(?:category|menu|item|list|카테고리|메뉴|항목|목록).*(?:next|다음)/i.test(name)
          ? "forward"
          : null;
    if (!direction) return;
    state.seen.add(direction);
    stopNavigationEmphasis(state);
    refreshNextItemButtons();
  }

  function removeGuide(): void {
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
    if (smartGuidePageTimer !== null) {
      globalThis.clearTimeout(smartGuidePageTimer);
      smartGuidePageTimer = null;
    }
    smartGuidePages = [];
    smartGuidePageIndex = 0;
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

  function guideIdentity(state: GuideState): string {
    const stepId = state.stepId ??
      `${adapter.getSnapshot().screenId}:${state.message?.actionId ?? ""}`;
    return JSON.stringify([
      stepId,
      state.message?.actionId ?? "",
      state.message?.title ?? "",
      state.message?.text ?? "",
    ]);
  }

  function finishSmartGuide(): void {
    smartGuideVisible = false;
    guideDeadline = 0;
    if (guideDismissTimer !== null) globalThis.clearTimeout(guideDismissTimer);
    if (guideCountdownTimer !== null) globalThis.clearTimeout(guideCountdownTimer);
    guideDismissTimer = null;
    guideCountdownTimer = null;
    if (smartGuidePageTimer !== null) globalThis.clearTimeout(smartGuidePageTimer);
    smartGuidePageTimer = null;
    smartGuidePages = [];
    smartGuidePageIndex = 0;
    highlightedAction?.classList.remove("a11y-guide-emphasis");
    highlightedAction = null;
    if (currentEasyExplanation()) renderGuidancePanel();
    else removeGuide();
  }

  function findGuideAction(actionId: string | null) {
    if (!actionId) return null;
    return adapter.getActions().find((action) => action.id === actionId) ?? null;
  }

  function scheduleGuideHitTest(
    target: HTMLElement,
    action: ReturnType<typeof findGuideAction> | undefined,
  ): void {
    if (guideValidationFrame) window.cancelAnimationFrame(guideValidationFrame);
    const overlay = guideOverlay;
    if (!overlay) return;
    if (typeof overlay.ownerDocument?.elementFromPoint !== "function") return;
    guideValidationFrame = window.requestAnimationFrame(() => {
      guideValidationFrame = 0;
      if (guideOverlay !== overlay || primaryActionsRemainHitTestable(overlay, adapter.getLayoutRegions())) return;
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

  function updateGuidePosition(): void {
    if (!guideOverlay) return;
    const action = smartGuideVisible
      ? findGuideAction(guideState.message?.actionId ?? null)
      : adapter.getActions().find((item) => item.primary && item.enabled) ??
        adapter.getActions().find((item) => item.enabled);
    const target = action?.element ?? root;
    if (!positionGuide(guideOverlay, target, root, adapter.getLayoutRegions())) {
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
    if (guideOverlay) scheduleGuideHitTest(target, action);
  }

  function scheduleGuidePosition(): void {
    if (destroyed || guidePositionFrame) return;
    guidePositionFrame = window.requestAnimationFrame(() => {
      guidePositionFrame = 0;
      updateGuidePosition();
    });
  }

  function showGuide(): void {
    if (
      destroyed ||
      completionActive ||
      smartGuideVisible ||
      !currentProfile.smartGuide ||
      !guideState.enabled ||
      guideState.paused ||
      !guideState.message?.actionId ||
      dismissedGuideIdentity === guideIdentity(guideState)
    ) {
      return;
    }

    const action = findGuideAction(guideState.message.actionId);
    const target = action?.element ?? null;
    if (!action || !target || !root.contains(target)) return;
    if (smartGuideVisible) finishSmartGuide();
    menuHint.setEnabled(true);
    smartGuideVisible = true;
    smartGuidePages = [guideState.message.text];
    smartGuidePageIndex = 0;
    highlightedAction = action.highlightElement ?? target;
    highlightedAction.classList.add("a11y-guide-emphasis");
    renderGuidancePanel();
    if (!guideOverlay) return;
    const fitted = fitSmartGuidePages(guideState.message.text);
    if (fitted.pages.length === 0) {
      const screenId = adapter.getSnapshot().screenId;
      const stepId = guideState.stepId ?? screenId;
      console.warn(`[kiosk-accessibility-sdk] Smart Guide step ${stepId} requires ${fitted.requiredPages} pages; maximum is 2. Host wording must be shortened.`);
      finishSmartGuide();
      return;
    }
    smartGuidePages = fitted.pages;
    const displayMs = currentProfile.slowGuidance
      ? 20_000
      : fitted.pages.length === 2 ? 15_000 : GUIDE_AUTO_DISMISS_MS;
    guideDeadline = Date.now() + displayMs;
    renderGuidancePanel();
    if (fitted.pages.length === 2) {
      smartGuidePageTimer = globalThis.setTimeout(() => {
        smartGuidePageTimer = null;
        if (!smartGuideVisible || smartGuidePages.length !== 2) return;
        smartGuidePageIndex = 1;
        renderGuidancePanel();
      }, displayMs / 2);
    }
    const visibleGuide = guideOverlay;
    guideDismissTimer = globalThis.setTimeout(() => {
      if (guideOverlay !== visibleGuide) return;
      guideDismissTimer = null;
      finishSmartGuide();
    }, displayMs);
    const updateCountdown = () => {
      if (guideOverlay !== visibleGuide || !smartGuideVisible) return;
      const remaining = Math.max(0, Math.ceil((guideDeadline - Date.now()) / 1000));
      const countdown = visibleGuide.querySelector<HTMLElement>("[data-a11y-guide-countdown]");
      if (countdown) countdown.textContent = `${remaining}초`;
      if (remaining > 0) {
        guideCountdownTimer = globalThis.setTimeout(updateCountdown, Math.min(1000, guideDeadline - Date.now()));
      }
    };
    guideCountdownTimer = globalThis.setTimeout(updateCountdown, 1000);
    speakText(guideState.message.text, currentProfile.voiceGuidance);
    menuHint.refresh();
  }

  function scheduleGuide(): void {
    timer.cancel();
    if (
      destroyed ||
      completionActive ||
      smartGuideVisible ||
      !currentProfile.smartGuide ||
      !guideState.enabled ||
      guideState.paused ||
      !guideState.message?.actionId ||
      dismissedGuideIdentity === guideIdentity(guideState)
    ) {
      return;
    }
    timer.reset(smartGuideDelayMs(guideState.delaySeconds));
  }

  function recordInteraction(event?: Event): void {
    if (destroyed) return;
    if (guideOverlay && event?.target instanceof Node && guideOverlay.contains(event.target)) return;
    interactionCount += 1;
    options.onInteractionCount?.(interactionCount);
    // User activity on the current screen must not end or extend the visible
    // guide. Only a host-reported step transition or the display deadline does.
    if (smartGuideVisible) return;
    scheduleGuide();
  }

  function recordScrollInteraction(): void {
    const now = Date.now();
    if (now - lastScrollAt < 250) return;
    lastScrollAt = now;
    if (smartGuideVisible) {
      interactionCount += 1;
      options.onInteractionCount?.(interactionCount);
      return;
    }
    recordInteraction();
  }

  function applyProfile(input: unknown): AccessibilityProfile {
    sessionEnded = false;
    menuHint.setEnabled(true);
    const previousVoiceGuidance = currentProfile.voiceGuidance;
    currentProfile = validateAccessibilityProfile(input);
    const nextClasses = new Set(accessibilityClasses(currentProfile));
    for (const className of MANAGED_CLASSES) {
      root.classList.toggle(className, nextClasses.has(className));
    }
    layoutEnhancer.applyProfile();
    if (
      currentProfile.textSize !== "standard" ||
      currentProfile.buttonSize === "large" ||
      currentProfile.bottomControls
    ) {
      layoutEnhancer.correctLayout();
    }
    // The QR profile is the source of truth for the viewport mode. Applying
    // v1/v2 normalizes it to null, while v3 applies its explicit setting here.
    setViewportMode(effectiveViewportMode());
    menuHint.refresh();
    refreshNextItemButtons();
    if (previousVoiceGuidance && !currentProfile.voiceGuidance) cancelSpeech();
    if (!currentProfile.smartGuide && smartGuideVisible) finishSmartGuide();
    else if (!currentProfile.easyLanguage && !smartGuideVisible) removeGuide();
    else renderGuidancePanel();
    scheduleGuide();
    return { ...currentProfile };
  }

  function setEasyLanguageState(state: EasyLanguageState): void {
    const stepId = typeof state.stepId === "string" ? state.stepId : "";
    const explanations = Array.isArray(state.explanations)
      ? state.explanations.slice(0, 100).filter((item) =>
        item && typeof item.title === "string" && typeof item.text === "string" &&
        item.title.trim().length > 0 && item.text.trim().length > 0,
      ).map((item) => ({ title: item.title, text: item.text }))
      : [];
    if (easyLanguageState?.stepId !== stepId) {
      easyLanguageIndex = 0;
    }
    easyLanguageSource = explanations;
    easyLanguageState = stepId && explanations.length > 0 ? { stepId, explanations } : null;
    easyLanguageIndex = Math.min(easyLanguageIndex, Math.max(0, explanations.length - 1));
    if (!smartGuideVisible) renderGuidancePanel();
  }

  function setGuideState(state: GuideState): void {
    const previous = guideState;
    const previousStepId = previous.stepId ??
      `${adapter.getSnapshot().screenId}:${previous.message?.actionId ?? ""}`;
    const nextStepId = state.stepId ??
      `${adapter.getSnapshot().screenId}:${state.message?.actionId ?? ""}`;
    const nextIdentity = guideIdentity(state);
    const dismissedBeforeUpdate = dismissedGuideIdentity;
    if (dismissedGuideIdentity && dismissedGuideIdentity !== nextIdentity) {
      dismissedGuideIdentity = null;
    }
    const sameStep = previousStepId === nextStepId &&
      previous.enabled === state.enabled &&
      previous.paused === state.paused &&
      previous.delaySeconds === state.delaySeconds;
    guideState = { ...state, message: state.message ? { ...state.message } : null };
    if (sameStep) {
      if (smartGuideVisible || currentEasyExplanation()) renderGuidancePanel();
      if (dismissedBeforeUpdate && !dismissedGuideIdentity) scheduleGuide();
      return;
    }
    const keepMatchingEasyPanel = currentProfile.easyLanguage &&
      easyLanguageState?.stepId === nextStepId;
    if (easyLanguageState && !keepMatchingEasyPanel) {
      easyLanguageState = null;
      easyLanguageSource = [];
      easyLanguageIndex = 0;
    }
    if (!keepMatchingEasyPanel || smartGuideVisible) {
      if (smartGuideVisible && keepMatchingEasyPanel) finishSmartGuide();
      else removeGuide();
    }
    renderGuidancePanel();
    scheduleGuide();
    menuHint.refresh();
  }

  function resetIdleTimer(): void {
    recordInteraction();
  }

  function speak(text: string): boolean {
    return speakText(text, currentProfile.voiceGuidance);
  }

  function inspectLayout(): AccessibilityDiagnostic[] {
    const corrections = layoutEnhancer.getLastCorrections();
    const recommendation: Record<string, string> = {
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
        severity: issue.issueType === "small-touch-target" ? "warning" as const : "error" as const,
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
        autoCorrection: correction?.outcome === "applied" ? "applied" as const :
          correction?.outcome === "failed" ? "failed" as const : "not-attempted" as const,
      };
    });
    options.onDiagnostics?.(issues);
    return issues;
  }

  function correctLayout(): LayoutCorrectionResult[] {
    return layoutEnhancer.correctLayout();
  }

  function getLastLayoutCorrections(): LayoutCorrectionResult[] {
    return layoutEnhancer.getLastCorrections();
  }

  function setViewportMode(config: BottomViewportConfig | null): boolean {
    const applied = bottomViewport.apply(config);
    syncQrEntryDockViewportMode(root, config?.mode === "bottom" ? config.heightPercent : null);
    if (applied) {
      menuHint.refresh();
      if (guideOverlay) {
        updateGuidePosition();
        if (easyLanguageState && !smartGuideVisible) renderGuidancePanel();
      }
    }
    return applied;
  }

  function notifyScreenChange(screenId: string): boolean {
    const changed = screenChange.notify(screenId);
    if (changed) {
      setViewportMode(effectiveViewportMode(screenId));
      easyLanguageState = null;
      easyLanguageSource = [];
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

  function beginCompletion(onReturn: CompletionReturnCallback): void {
    if (destroyed || sessionEnded) return;
    timer.cancel();
    removeGuide();
    completionScreenId = adapter.getSnapshot().screenId;
    completion.begin(onReturn);
  }

  function cancelCompletion(): void {
    completionScreenId = null;
    completion.cancel();
  }

  function endSession(): void {
    sessionGeneration += 1;
    screenChange.reset();
    timer.cancel();
    cancelCompletion();
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
    dismissedGuideIdentity = null;
    easyLanguageState = null;
    easyLanguageSource = [];
    easyLanguageIndex = 0;
    for (const state of navigationStates.values()) stopNavigationEmphasis(state);
    navigationStates.clear();
    removeGuide();
    cancelSpeech();
    bottomViewport.apply(null);
    applyProfile(DEFAULT_ACCESSIBILITY_PROFILE);
    sessionEnded = true;
    for (const state of navigationStates.values()) stopNavigationEmphasis(state);
    navigationStates.clear();
    for (const button of emphasizedNextButtons) button.classList.remove("a11y-next-item-emphasis");
    emphasizedNextButtons.clear();
    menuHint.setEnabled(false);
    menuHint.clear();
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
  root.addEventListener("scroll", refreshNextItemButtons, true);
  root.addEventListener("click", onNavigationClick, true);
  window.addEventListener("resize", refreshNextItemButtons, { passive: true });
  if (options.viewportMode) setViewportMode(options.viewportMode);
  nextItemObserver?.observe(document.body ?? root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "aria-controls", "aria-disabled", "disabled", "hidden", "aria-hidden"],
  });
  refreshNextItemButtons();
  if (!("PointerEvent" in window)) root.addEventListener("touchstart", recordInteraction, { passive: true });
  window.addEventListener("scroll", recordScrollInteraction, { capture: true, passive: true });

  const sdk: AccessibilitySdk = {
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
      if (destroyed) return;
      endSession();
      destroyed = true;
      screenChange.destroy();
      nextItemObserver?.disconnect();
      if (nextItemRefreshFrame) window.cancelAnimationFrame(nextItemRefreshFrame);
      if (guidePositionFrame) window.cancelAnimationFrame(guidePositionFrame);
      for (const button of emphasizedNextButtons) button.classList.remove("a11y-next-item-emphasis");
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
      if (addedKioskClass) root.classList.remove("kiosk");
      sessionCleanups.clear();
    },
  };

  return sdk;
}
