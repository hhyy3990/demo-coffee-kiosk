export declare const ACCESSIBILITY_PROFILE_SCHEMA_VERSION: 2;
export declare const ACCESSIBILITY_SDK_VERSION: "0.3.5";
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
export declare const DEFAULT_ACCESSIBILITY_PROFILE: Readonly<AccessibilityProfile>;
export declare function validateAccessibilityProfile(input: unknown): AccessibilityProfile;
export declare function accessibilityClasses(profile: AccessibilityProfile): string[];
