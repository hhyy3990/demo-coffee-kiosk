import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  DEFAULT_ACCESSIBILITY_PROFILE,
  accessibilityClasses,
  validateAccessibilityProfile,
} = sdk;

test("profile validator preserves the central QR schema and known values", () => {
  const profile = validateAccessibilityProfile({
    ...DEFAULT_ACCESSIBILITY_PROFILE,
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: true,
    viewportMode: null,
    bottomControls: true,
    smartGuide: true,
    voiceGuidance: true,
    guideDelaySeconds: 20,
  });

  assert.equal(ACCESSIBILITY_PROFILE_SCHEMA_VERSION, 3);
  assert.deepEqual(Object.keys(profile), Object.keys(DEFAULT_ACCESSIBILITY_PROFILE));
  assert.deepEqual(profile, {
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: true,
    bottomControls: true,
    viewportMode: null,
    smartGuide: true,
    voiceGuidance: true,
    guideDelaySeconds: 20,
  });
});

test("invalid and missing required fields fail closed", () => {
  assert.deepEqual(validateAccessibilityProfile(null), DEFAULT_ACCESSIBILITY_PROFILE);
  assert.deepEqual(validateAccessibilityProfile({ textSize: "gigantic", guideDelaySeconds: 2 }), DEFAULT_ACCESSIBILITY_PROFILE);
});

test("profile maps only to scoped SDK class names", () => {
  assert.deepEqual(accessibilityClasses(validateAccessibilityProfile({
    ...DEFAULT_ACCESSIBILITY_PROFILE,
    textSize: "large",
    contrast: "high",
    bottomControls: true,
  })), ["a11y-text-large", "a11y-high-contrast", "a11y-bottom-controls"]);
});
