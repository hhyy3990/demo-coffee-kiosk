export const ACCESSIBILITY_PROFILE_SCHEMA_VERSION = 2;
export const ACCESSIBILITY_SDK_VERSION = "0.3.6";
export const DEFAULT_ACCESSIBILITY_PROFILE = Object.freeze({
    textSize: "standard",
    buttonSize: "standard",
    contrast: "standard",
    easyLanguage: false,
    bottomControls: false,
    smartGuide: false,
    voiceGuidance: false,
    guideDelaySeconds: 15,
});
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateAccessibilityProfile(input) {
    if (!isRecord(input))
        return { ...DEFAULT_ACCESSIBILITY_PROFILE };
    const textSize = input.textSize === "large" || input.textSize === "extraLarge" ? input.textSize : "standard";
    const buttonSize = input.buttonSize === "large" ? "large" : "standard";
    const contrast = input.contrast === "high" ? "high" : "standard";
    const guideDelaySeconds = input.guideDelaySeconds === 10 || input.guideDelaySeconds === 20 ? input.guideDelaySeconds : 15;
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
export function accessibilityClasses(profile) {
    return [
        profile.textSize === "large" ? "a11y-text-large" : "",
        profile.textSize === "extraLarge" ? "a11y-text-extra" : "",
        profile.buttonSize === "large" ? "a11y-controls-large" : "",
        profile.contrast === "high" ? "a11y-high-contrast" : "",
        profile.easyLanguage ? "a11y-easy-language" : "",
        profile.bottomControls ? "a11y-bottom-controls" : "",
    ].filter(Boolean);
}
//# sourceMappingURL=profile.js.map