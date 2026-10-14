import {
  createAccessibilitySdk,
  createQrEntryDock,
  createQrProfileClient,
  DEFAULT_ACCESSIBILITY_PROFILE,
  validateAccessibilityProfile,
  type AccessibilityAdapter,
  type AccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import type { QrScannerHandle } from "@naebangsik/kiosk-accessibility-sdk/qr-scanner";

const root = document.createElement("main");
const button = document.createElement("button");
const adapter: AccessibilityAdapter = {
  getSnapshot: () => ({ screenId: "independent.confirm", state: { step: "review" } }),
  getActions: () => [{
    id: "independent.confirm",
    name: "Continue",
    element: button,
    enabled: true,
  }],
  getTextTargets: () => [],
  getLayoutRegions: () => ({ bottomControls: [], scrollArea: root }),
};
const profile: AccessibilityProfile = validateAccessibilityProfile({
  ...DEFAULT_ACCESSIBILITY_PROFILE,
  textSize: "large",
});
const sdk = createAccessibilitySdk({ root, adapter });
const qrDock = createQrEntryDock({
  root,
  adapter,
  active: true,
  onOpenQr() {},
  theme: { button: "#704b32", buttonForeground: "#fffaf1" },
  bottomViewportPercent: 70,
});
qrDock.setActive(false);
qrDock.setActive(true);
qrDock.destroy();
const qrClient = createQrProfileClient();

sdk.applyProfile(profile);
const screenChanged: boolean = sdk.notifyScreenChange("independent.confirm");
sdk.setViewportMode({ mode: "bottom", heightPercent: 70 });
sdk.setViewportMode(null);
sdk.setGuideState({
  stepId: "independent.confirm.continue",
  enabled: profile.smartGuide,
  paused: false,
  delaySeconds: profile.guideDelaySeconds,
  message: { title: "Continue", text: "Use the button.", actionId: "independent.confirm" },
});
sdk.setEasyLanguageState({
  stepId: "independent.confirm.continue",
  explanations: [
    { title: "Review", text: "Check the information." },
    { title: "Continue", text: "Select the continue button." },
  ],
});
sdk.inspectLayout();
sdk.correctLayout();
sdk.getLastLayoutCorrections();
const isCurrentSession = sdk.createSessionGuard();
if (isCurrentSession()) sdk.endSession();
void screenChanged;
const unregisterCleanup = sdk.registerSessionCleanup(() => qrClient.cancel());
unregisterCleanup();
sdk.destroy();
qrClient.cancel();
function disposeScanner(scanner: QrScannerHandle | null) {
  scanner?.destroy();
}
disposeScanner(null);
