import {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  ACCESSIBILITY_SDK_VERSION,
  DEFAULT_ACCESSIBILITY_PROFILE,
  createAccessibilitySdk,
  validateAccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
import "./host.css";

const root = document.querySelector("#kiosk-root");
const continueButton = document.querySelector("#host-continue");
const hostState = { step: "review", actionCount: 0 };
let keypadClicks = 0;
let quantity = 1;
let optionChanges = 0;
const guidePlacementDiagnostics = [];

continueButton.addEventListener("click", () => {
  hostState.actionCount += 1;
  document.querySelector("#host-state").textContent = `업무 작업 ${hostState.actionCount}회`;
});
root.querySelectorAll(".keypad button").forEach((button) => button.addEventListener("click", () => {
  keypadClicks += 1;
}));
root.querySelectorAll(".fixture-choices input").forEach((input) => input.addEventListener("change", () => {
  optionChanges += 1;
}));
document.querySelector("#quantity-minus").addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  document.querySelector("#quantity-count").textContent = String(quantity);
});
document.querySelector("#quantity-plus").addEventListener("click", () => {
  quantity += 1;
  document.querySelector("#quantity-count").textContent = String(quantity);
});

const adapter = {
  getSnapshot: () => ({
    screenId: `host.${hostState.step}`,
    state: { step: hostState.step, actionCount: hostState.actionCount },
  }),
  getActions: () => [{
    id: "host.review.continue",
    name: "계속",
    element: continueButton,
    enabled: !continueButton.disabled,
    primary: true,
  }],
  getTextTargets: () => [...root.querySelectorAll("[data-a11y-text]")].map((element) => ({
    id: element.dataset.a11yId,
    element,
  })),
    getLayoutRegions: () => ({
      bottomControls: [document.querySelector(".bottom-controls")],
      scrollArea: document.querySelector(".content"),
      primaryActions: [
        continueButton,
        root.querySelector("#test-pin"),
        ...root.querySelectorAll(".keypad button"),
        ...root.querySelectorAll(".fixture-choices input"),
        ...root.querySelectorAll(".fixture-quantity button"),
      ].filter(Boolean).map((element) => ({ element })),
      menuItems: [...root.querySelectorAll(".fixture-menu-item")],
      guidanceAvoidAreas: [root.querySelector(".keypad")].filter(Boolean),
    }),
};

const sdk = createAccessibilitySdk({
  root,
  adapter,
  onDiagnostics: (issues) => guidePlacementDiagnostics.push(
    ...issues.filter((issue) => issue.issueType === "guide-suppressed"),
  ),
});
let profile = validateAccessibilityProfile({
  ...DEFAULT_ACCESSIBILITY_PROFILE,
  textSize: "extraLarge",
  buttonSize: "large",
  contrast: "high",
  easyLanguage: true,
  bottomControls: true,
  smartGuide: true,
  guideDelaySeconds: 10,
});

sdk.applyProfile(profile);
const easyExplanations = [
  { title: "확인 단계", text: "입력한 내용을 확인하는 화면입니다." },
  { title: "다음으로 이동", text: "내용이 맞으면 계속 버튼을 누릅니다." },
  { title: "도움 요청", text: "어려우면 직원에게 도움을 요청할 수 있습니다." },
];
const guideStep = "host.review.continue";
sdk.setEasyLanguageState({ stepId: guideStep, explanations: easyExplanations });
sdk.setGuideState({
  stepId: guideStep,
  enabled: profile.smartGuide,
  paused: true,
  delaySeconds: profile.guideDelaySeconds,
  message: {
    title: "다음 단계",
    text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
    actionId: "host.review.continue",
  },
});

document.querySelector("#sdk-status").textContent =
  `SDK ${ACCESSIBILITY_SDK_VERSION} · 프로필 ${ACCESSIBILITY_PROFILE_SCHEMA_VERSION} · 초기화 완료`;

window.__sdkPackageSmoke = {
  loadQrScanner: () => import("@naebangsik/kiosk-accessibility-sdk/qr-scanner"),
  async runQrContract() {
    const { mountQrScanner } = await import("@naebangsik/kiosk-accessibility-sdk/qr-scanner");
    const host = document.createElement("div");
    root.append(host);
    const controls = { stops: 0, stop() { this.stops += 1; } };
    const found = [];
    const scanner = mountQrScanner({
      container: host,
      readerFactory: () => ({
        decodeFromVideoDevice(_device, _video, callback) {
          queueMicrotask(() => {
            callback({ getText: () => "https://naebangsikqr.replit.app/profile?token=consumer-test" }, undefined, controls);
            callback({ getText: () => "duplicate" }, undefined, controls);
          });
          return Promise.resolve(controls);
        },
      }),
      onScan: (value) => found.push(value),
      onCameraUnavailable() {},
    });
    await scanner.start();
    const scanResult = { count: found.length, stoppedTracks: controls.stops, text: found[0] };
    scanner.destroy();

    let cameraError = "";
    const deniedScanner = mountQrScanner({
      container: host,
      readerFactory: () => ({
        decodeFromVideoDevice: async () => { throw new DOMException("denied", "NotAllowedError"); },
      }),
      onScan() {},
      onCameraUnavailable: (message) => { cameraError = message; },
    });
    await deniedScanner.start();
    const permissionFallback = { message: cameraError, manualFallbackAvailable: true };
    deniedScanner.destroy();
    const qrClient = createQrProfileClient({
      fetcher: async (url) => {
        if (url !== "/api/qr-profile") throw new Error("Unexpected profile endpoint");
        return new Response(JSON.stringify({ preferences: profile }), { status: 200 });
      },
    });
    const invalidRejected = await qrClient.resolve("https://attacker.example/?token=x", "scan")
      .then(() => false, (error) => error.message === "QR_UNAVAILABLE");
    const loadedProfile = await qrClient.resolve(
      "https://naebangsikqr.replit.app/profile?token=consumer-test",
      "scan",
    );
    return {
      scanResult,
      permissionFallback,
      invalidRejected,
      profileLoaded: loadedProfile.textSize === "extraLarge",
      scannerContainersCleaned: host.childNodes.length === 0,
    };
  },
  async runStageGuidanceProbe(heightPercent = null, guideMode = "easy") {
    const enableEasy = guideMode !== "smart";
    const enableSmart = guideMode !== "easy";
    root.classList.add("stage-fixture");
    const stage = root.querySelector(".content");
    const next = root.querySelector("#host-continue");
    profile = validateAccessibilityProfile({
      ...profile,
      viewportMode: heightPercent === null ? null : { mode: "bottom", heightPercent },
      easyLanguage: enableEasy,
      smartGuide: enableSmart,
      slowGuidance: true,
      guideDelaySeconds: 10,
    });
    sdk.applyProfile(profile);
    if (enableEasy) sdk.setEasyLanguageState({
        stepId: guideStep,
        explanations: [{ title: "확인 단계", text: "입력한 내용을 확인한 뒤 계속 진행합니다." }],
      });
    const guideMessage = {
      title: "다음 단계",
      text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
      actionId: "host.review.continue",
    };
    sdk.setGuideState({
      stepId: guideStep, enabled: enableSmart, paused: true,
      delaySeconds: 10, message: guideMessage,
    });
    const frame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sample = async (state, requestedTop) => {
      stage.scrollTop = requestedTop;
      await frame();
      const guide = root.querySelector(".a11y-guide-toast");
      const hint = root.querySelector(".a11y-additional-menu-hint");
      const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null;
      const stageRect = stage.getBoundingClientRect();
      const actions = [...root.querySelectorAll(".keypad button, .fixture-choices input, .fixture-quantity button, #host-continue")];
      const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left &&
        a.top < b.bottom && a.bottom > b.top;
      const guideRect = rect(guide);
      const hintRect = rect(hint);
      const hitTests = actions.map((element) => {
        const r = element.getBoundingClientRect();
        const left = Math.max(r.left, stageRect.left, 0);
        const right = Math.min(r.right, stageRect.right, innerWidth);
        const top = Math.max(r.top, stageRect.top, 0);
        const bottom = Math.min(r.bottom, stageRect.bottom, innerHeight);
        const visible = right > left && bottom > top;
        if (!visible) return { id: element.id || element.textContent.trim(), visible, hit: true,
          guideOverlap: false, hintOverlap: false };
        const x = left + (right - left) / 2;
        const y = top + (bottom - top) / 2;
        const hit = document.elementFromPoint(x, y);
        const label = element instanceof HTMLInputElement ? element.labels?.[0] : null;
        return {
          id: element.id || element.textContent.trim(), visible,
          hit: hit === element || element.contains(hit) || Boolean(label?.contains(hit)),
          guideOverlap: guide?.isConnected && getComputedStyle(guide).visibility === "visible" &&
            overlaps(r, guideRect),
          hintOverlap: hint?.isConnected && getComputedStyle(hint).visibility === "visible" &&
            overlaps(r, hintRect),
        };
      });
      return {
        state, requestedTop, scrollTop: stage.scrollTop,
        stage: rect(stage), scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight,
        guide: guide ? { rect: rect(guide), smart: guide.classList.contains("a11y-guide-smart"),
          visible: getComputedStyle(guide).visibility === "visible" } : null,
        hint: hint ? { rect: rect(hint), visible: getComputedStyle(hint).visibility === "visible" } : null,
        nextAction: rect(next), hitTests,
      };
    };
    const max = stage.scrollHeight - stage.clientHeight;
    const tops = [0, 240, 480, max, 0].map((top) => Math.min(max, top));
    const easy = [];
    for (const top of tops) easy.push(await sample("easy", top));
    let smartVisible = false;
    if (enableSmart) {
      sdk.setGuideState({
        stepId: guideStep, enabled: true, paused: false,
        delaySeconds: 0, message: guideMessage,
      });
      for (let attempt = 0; attempt < 115; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        smartVisible = Boolean(root.querySelector(".a11y-guide-toast.a11y-guide-smart"));
        if (smartVisible) break;
      }
    }
    const smart = [];
    if (smartVisible && enableSmart) {
      for (const top of tops) smart.push(await sample("smart", top));
    }
    return { viewport: { width: innerWidth, height: innerHeight },
      stageScrollHeight: stage.scrollHeight, stageClientHeight: stage.clientHeight,
      maxScroll: Math.max(0, stage.scrollHeight - stage.clientHeight),
      noSafeSpace: root.dataset.a11yScrollGuidance === "no-safe-space",
      guideMode,
      smartVisible, easy, smart };
  },
  read() {
    return {
      profile,
      classes: [...root.classList].filter((name) => name.startsWith("a11y-")),
      actionCount: hostState.actionCount,
      keypadClicks,
      quantity,
      optionChanges,
      guidePlacementDiagnostics,
      guideVisible: Boolean(root.querySelector(".a11y-guide-toast")),
      actionHighlighted: continueButton.classList.contains("a11y-guide-emphasis"),
      diagnostics: sdk.inspectLayout(),
    };
  },
  readInteractionState() {
    return { keypadClicks, quantity, optionChanges, scrollTop: window.scrollY,
      guide: this.readGuidance() };
  },
  updateGuideCopy(text) {
    sdk.setGuideState({
      stepId: guideStep,
      enabled: profile.smartGuide,
      paused: false,
      delaySeconds: profile.guideDelaySeconds,
      message: {
        title: "다음 단계",
        text,
        actionId: "host.review.continue",
      },
    });
  },
  readGuidance() {
    const panel = root.querySelector(".a11y-guide-toast");
    const rect = panel?.getBoundingClientRect();
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const measure = (selector) => {
      const element = panel?.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height } : null;
    };
    return {
      visible: Boolean(panel && panelStyle?.display !== "none" && panelStyle?.visibility === "visible" &&
        Number(panelStyle.opacity) > 0 && rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < innerHeight),
      panelVisibility: panelStyle?.visibility ?? "",
      panelOpacity: panelStyle?.opacity ?? "",
      ariaHidden: panel?.getAttribute("aria-hidden") ?? "",
      suppressed: panel?.dataset.a11yPositionSuppressed === "true",
      title: panel?.querySelector("[data-a11y-guide-title]")?.textContent ?? "",
      text: panel?.querySelector("[data-a11y-guide-text]")?.textContent ?? "",
      textVisible: Boolean(panel?.querySelector("[data-a11y-guide-text]")?.getClientRects().length &&
        getComputedStyle(panel.querySelector("[data-a11y-guide-text]")).display !== "none"),
      page: panel?.querySelector("[data-a11y-guide-page]")?.textContent ?? "",
      collapsed: panel?.classList.contains("a11y-guide-collapsed") ?? false,
      pagerHidden: panel?.querySelector("[data-a11y-guide-pager]")?.hidden ?? true,
      previousHidden: panel?.querySelector("[data-a11y-guide-previous]")?.hidden ?? true,
      nextHidden: panel?.querySelector("[data-a11y-guide-next]")?.hidden ?? true,
      countdown: panel?.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
      panelRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      headerRect: measure(".a11y-guide-header"),
      titleRect: measure("[data-a11y-guide-title]"),
      iconRect: measure(".a11y-guide-icon"),
      iconAriaHidden: panel?.querySelector(".a11y-guide-icon")?.getAttribute("aria-hidden") ?? "",
      countdownRect: measure("[data-a11y-guide-countdown]"),
      collapseRect: measure("[data-a11y-guide-collapse]"),
      collapseLabel: panel?.querySelector("[data-a11y-guide-collapse]")?.textContent ?? "",
      collapseAccessibleName: panel?.querySelector("[data-a11y-guide-collapse]")?.getAttribute("aria-label") ?? "",
      closeRect: measure(".a11y-guide-close"),
      closeLabel: panel?.querySelector(".a11y-guide-close")?.getAttribute("aria-label") ?? "",
      textRect: measure("[data-a11y-guide-text]"),
      previousRect: measure("[data-a11y-guide-previous]"),
      nextRect: measure("[data-a11y-guide-next]"),
      pageRect: measure("[data-a11y-guide-page]"),
      titleFontSize: panel ? getComputedStyle(panel.querySelector("[data-a11y-guide-title]")).fontSize : "",
      bodyFontSize: panel ? getComputedStyle(panel.querySelector("[data-a11y-guide-text]")).fontSize : "",
      actionRect: (() => {
        const button = continueButton.getBoundingClientRect();
        return { left: button.left, top: button.top, right: button.right, bottom: button.bottom };
      })(),
      keypadRect: (() => {
        const keypad = root.querySelector(".keypad")?.getBoundingClientRect();
        return keypad ? { left: keypad.left, top: keypad.top, right: keypad.right, bottom: keypad.bottom } : null;
      })(),
    };
  },
  startGuide(slow = false, delaySeconds = 10) {
    const current = validateAccessibilityProfile({ ...profile, slowGuidance: slow });
    sdk.applyProfile(current);
    sdk.setEasyLanguageState({ stepId: guideStep, explanations: easyExplanations });
    sdk.setGuideState({
      stepId: guideStep,
      enabled: true,
      paused: false,
      delaySeconds,
      message: { title: "스마트 길잡이", text: "계속 버튼을 눌러 진행하세요.", actionId: "host.review.continue" },
    });
    return performance.now();
  },
  setViewport(percent) {
    return sdk.setViewportMode(percent ? { mode: "bottom", heightPercent: percent } : null);
  },
  setTestProfile(overrides = {}) {
    profile = validateAccessibilityProfile({ ...profile, ...overrides });
    sdk.applyProfile(profile);
    sdk.setEasyLanguageState({ stepId: guideStep, explanations: easyExplanations });
    sdk.setGuideState({
      stepId: guideStep,
      enabled: profile.smartGuide,
      paused: true,
      delaySeconds: 10,
      message: { title: "스마트 길잡이", text: "계속 버튼을 눌러 진행하세요.", actionId: "host.review.continue" },
    });
    return profile;
  },
  moveToStep(step) {
    sdk.notifyScreenChange(step);
    sdk.setEasyLanguageState({
      stepId: step,
      explanations: [{ title: "새 단계", text: "새 화면의 안내입니다." }],
    });
    sdk.setGuideState({
      stepId: step,
      enabled: true,
      paused: true,
      delaySeconds: 10,
      message: { title: "새 단계 안내", text: "새 화면 내용을 확인하세요.", actionId: "host.review.continue" },
    });
  },
  endSession() {
    const actionCount = hostState.actionCount;
    sdk.endSession();
    return { panelVisible: Boolean(root.querySelector(".a11y-guide-toast")), actionCount: hostState.actionCount };
  },
  destroy() {
    sdk.destroy();
    return [...root.classList];
  },
};
