export const ACCESSIBILITY_PROFILE_SCHEMA_VERSION = 2 as const;
export const ACCESSIBILITY_SDK_VERSION = "0.3.5" as const;

export type TextSize = "standard" | "large" | "extraLarge";
export type ButtonSize = "standard" | "large";
export type ContrastMode = "standard" | "high";
export type GuideDelaySeconds = 10 | 15 | 20;

/**
 * This field set intentionally matches the existing central QR profile.
 * Keep wire-format changes out of the SDK's presentation API.
 */
export interface AccessibilityProfile {
  textSize: TextSize;
  buttonSize: ButtonSize;
  contrast: ContrastMode;
  easyLanguage: boolean;
  bottomControls: boolean;
  smartGuide: boolean;
  voiceGuidance: boolean;
  guideDelaySeconds: GuideDelaySeconds;
}

export const DEFAULT_ACCESSIBILITY_PROFILE: Readonly<AccessibilityProfile> = Object.freeze({
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  easyLanguage: false,
  bottomControls: false,
  smartGuide: false,
  voiceGuidance: false,
  guideDelaySeconds: 15,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAccessibilityProfile(input: unknown): AccessibilityProfile {
  if (!isRecord(input)) return { ...DEFAULT_ACCESSIBILITY_PROFILE };
  const textSize: TextSize =
    input.textSize === "large" || input.textSize === "extraLarge" ? input.textSize : "standard";
  const buttonSize: ButtonSize = input.buttonSize === "large" ? "large" : "standard";
  const contrast: ContrastMode = input.contrast === "high" ? "high" : "standard";
  const guideDelaySeconds: GuideDelaySeconds =
    input.guideDelaySeconds === 10 || input.guideDelaySeconds === 20 ? input.guideDelaySeconds : 15;

  return {
    textSize,
    buttonSize,
    contrast,
    easyLanguage: input.easyLanguage === true,
    bottomControls: input.bottomControls === true,
    smartGuide: input.smartGuide === true,
    voiceGuidance: input.voiceGuidance === true,
    guideDelaySeconds,
  };
}

export function accessibilityClasses(profile: AccessibilityProfile): string[] {
  return [
    profile.textSize === "large" ? "a11y-text-large" : "",
    profile.textSize === "extraLarge" ? "a11y-text-extra" : "",
    profile.buttonSize === "large" ? "a11y-controls-large" : "",
    profile.contrast === "high" ? "a11y-high-contrast" : "",
    profile.easyLanguage ? "a11y-easy-language" : "",
    profile.bottomControls ? "a11y-bottom-controls" : "",
  ].filter(Boolean);
}
