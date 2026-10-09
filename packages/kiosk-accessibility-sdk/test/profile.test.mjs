import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  DEFAULT_ACCESSIBILITY_PROFILE,
  accessibilityClasses,
  validateAccessibilityProfile,
} from "../src/profile.ts";

test("profile validator preserves the central QR schema and known values", () => {
  const profile = validateAccessibilityProfile({
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: true,
    simplifiedLayout: true,
    bottomControls: true,
    smartGuide: true,
    voiceGuidance: true,
    guideDelaySeconds: 20,
  });

  assert.equal(ACCESSIBILITY_PROFILE_SCHEMA_VERSION, "1.0.0");
  assert.deepEqual(Object.keys(profile), Object.keys(DEFAULT_ACCESSIBILITY_PROFILE));
  assert.deepEqual(profile, {
    textSize: "extraLarge",
    buttonSize: "large",
    contrast: "high",
    easyLanguage: true,
    simplifiedLayout: true,
    bottomControls: true,
    smartGuide: true,
    voiceGuidance: true,
    guideDelaySeconds: 20,
  });
});

test("invalid and missing fields fall back without inventing profile values", () => {
  assert.deepEqual(validateAccessibilityProfile(null), DEFAULT_ACCESSIBILITY_PROFILE);
  assert.deepEqual(validateAccessibilityProfile({ textSize: "gigantic", guideDelaySeconds: 2 }), {
    ...DEFAULT_ACCESSIBILITY_PROFILE,
  });
});

test("profile maps only to scoped SDK class names", () => {
  assert.deepEqual(accessibilityClasses(validateAccessibilityProfile({
    textSize: "large",
    contrast: "high",
    bottomControls: true,
  })), ["a11y-text-large", "a11y-high-contrast", "a11y-bottom-controls"]);
});
