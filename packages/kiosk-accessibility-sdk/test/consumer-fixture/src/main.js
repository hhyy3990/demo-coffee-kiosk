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

continueButton.addEventListener("click", () => {
  hostState.actionCount += 1;
  document.querySelector("#host-state").textContent = `업무 작업 ${hostState.actionCount}회`;
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
  }),
};

const sdk = createAccessibilitySdk({ root, adapter });
const profile = validateAccessibilityProfile({
  ...DEFAULT_ACCESSIBILITY_PROFILE,
  textSize: "extraLarge",
  buttonSize: "large",
  contrast: "high",
  easyLanguage: true,
  simplifiedLayout: true,
  bottomControls: true,
  smartGuide: true,
  guideDelaySeconds: 10,
});

sdk.applyProfile(profile);
sdk.setGuideState({
  enabled: profile.smartGuide,
  paused: false,
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
  read() {
    return {
      profile,
      classes: [...root.classList].filter((name) => name.startsWith("a11y-")),
      actionCount: hostState.actionCount,
      guideVisible: Boolean(root.querySelector(".a11y-guide-toast")),
      actionHighlighted: continueButton.classList.contains("a11y-guide-emphasis"),
      diagnostics: sdk.inspectLayout(),
    };
  },
  destroy() {
    sdk.destroy();
    return [...root.classList];
  },
};
