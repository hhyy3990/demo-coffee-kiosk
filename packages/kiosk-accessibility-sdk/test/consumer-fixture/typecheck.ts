import {
  createAccessibilitySdk,
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
const qrClient = createQrProfileClient();

sdk.applyProfile(profile);
sdk.setGuideState({
  enabled: profile.smartGuide,
  paused: false,
  delaySeconds: profile.guideDelaySeconds,
  message: { title: "Continue", text: "Use the button.", actionId: "independent.confirm" },
});
sdk.inspectLayout();
const isCurrentSession = sdk.createSessionGuard();
if (isCurrentSession()) sdk.endSession();
const unregisterCleanup = sdk.registerSessionCleanup(() => qrClient.cancel());
unregisterCleanup();
sdk.destroy();
qrClient.cancel();
function disposeScanner(scanner: QrScannerHandle | null) {
  scanner?.destroy();
}
disposeScanner(null);
