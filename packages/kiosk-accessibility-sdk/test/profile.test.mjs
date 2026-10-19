import test from "node:test";
import assert from "node:assert/strict";
import { sdk } from "./load-sdk.mjs";
const {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  DEFAULT_ACCESSIBILITY_PROFILE,
  PROFILE_LANGUAGES,
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

  assert.equal(ACCESSIBILITY_PROFILE_SCHEMA_VERSION, 5);
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
    language: "ko",
    stepByStepGuidance: false,
    conciseGuidance: false,
    slowGuidance: false,
    scrollGuidance: false,
  });
});

test("profile normalization exposes valid new preferences and defaults invalid values safely", () => {
  const profile = validateAccessibilityProfile({
    ...DEFAULT_ACCESSIBILITY_PROFILE,
    language: "uz",
    stepByStepGuidance: true,
    conciseGuidance: true,
    slowGuidance: true,
  });
  assert.deepEqual(
    [profile.language, profile.stepByStepGuidance, profile.conciseGuidance, profile.slowGuidance],
    ["uz", true, true, true],
  );
  assert.equal(PROFILE_LANGUAGES.length, 7);
  const invalid = validateAccessibilityProfile({
    language: "fr",
    stepByStepGuidance: "yes",
    conciseGuidance: 1,
    slowGuidance: null,
  });
  assert.deepEqual(
    [invalid.language, invalid.stepByStepGuidance, invalid.conciseGuidance, invalid.slowGuidance],
    ["ko", false, false, false],
  );
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
