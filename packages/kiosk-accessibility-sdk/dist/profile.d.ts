import type { BottomViewportConfig } from "./bottom-viewport.ts";
export declare const ACCESSIBILITY_PROFILE_SCHEMA_VERSION: 4;
export declare const ACCESSIBILITY_SDK_VERSION: "0.5.18";
export type TextSize = "standard" | "large" | "extraLarge";
export type ButtonSize = "standard" | "large";
export type ContrastMode = "standard" | "high";
export type GuideDelaySeconds = 10 | 15 | 20;
export declare const PROFILE_LANGUAGES: readonly ["ko", "zh", "vi", "en", "th", "uz", "ja"];
export type ProfileLanguage = (typeof PROFILE_LANGUAGES)[number];
/**
 * This field set intentionally matches the existing central QR profile.
 * Keep wire-format changes out of the SDK's presentation API.
 */
export interface AccessibilityProfile {
    textSize: TextSize;
    buttonSize: ButtonSize;
    contrast: ContrastMode;
    easyLanguage: boolean;
    /** Legacy v1/v2 preference. It never implies a bottom viewport. */
    bottomControls: boolean;
    /** Explicit v3 setting; null means standard full-height layout. */
    viewportMode: BottomViewportConfig | null;
    smartGuide: boolean;
    voiceGuidance: boolean;
    guideDelaySeconds: GuideDelaySeconds;
    language: ProfileLanguage;
    stepByStepGuidance: boolean;
    conciseGuidance: boolean;
    slowGuidance: boolean;
}
export declare const DEFAULT_ACCESSIBILITY_PROFILE: Readonly<AccessibilityProfile>;
export declare function validateAccessibilityProfile(input: unknown): AccessibilityProfile;
export declare function accessibilityClasses(profile: AccessibilityProfile): string[];
