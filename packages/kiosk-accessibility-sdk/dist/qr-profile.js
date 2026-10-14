import { PROFILE_LANGUAGES, validateAccessibilityProfile, } from "./profile.js";
export const CENTRAL_QR_ORIGIN = "https://naebangsikqr.replit.app";
const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/=-]{20,128}$/;
const PROFILE_ENDPOINT = "/api/qr-profile";
export function isValidProfileToken(value) {
    return value.trim() === value && TOKEN_PATTERN.test(value);
}
function tokenFromOfficialUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.origin !== CENTRAL_QR_ORIGIN || url.username || url.password)
            return "";
        const values = url.searchParams.getAll("token");
        return values.length === 1 && isValidProfileToken(values[0]) ? values[0] : "";
    }
    catch {
        return "";
    }
}
export function getScannedProfileToken(value) {
    const trimmed = value.trim();
    return trimmed.length <= 2048 ? tokenFromOfficialUrl(trimmed) : "";
}
export function getManualProfileToken(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 2048)
        return "";
    if (/^(https?:\/\/|\/\/|\/|\?|www\.)/i.test(trimmed) || /^[\w.-]+\.[a-z]{2,}(?:\/|[?#]|$)/i.test(trimmed)) {
        if (trimmed.startsWith("//") || trimmed.startsWith("/") || trimmed.startsWith("?"))
            return "";
        return tokenFromOfficialUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    }
    return isValidProfileToken(trimmed) ? trimmed : "";
}
function profileFromCentralResponse(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("QR_UNAVAILABLE");
    const record = body;
    if (record.schemaVersion !== 1 && record.schemaVersion !== 2 &&
        record.schemaVersion !== 3 && record.schemaVersion !== 4) {
        throw new Error("QR_UNAVAILABLE");
    }
    if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
        throw new Error("QR_UNAVAILABLE");
    }
    const preferences = record.preferences;
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        throw new Error("QR_UNAVAILABLE");
    }
    const profileData = preferences;
    if (record.schemaVersion >= 2 && "simplifiedLayout" in profileData) {
        throw new Error("QR_UNAVAILABLE");
    }
    const schemaVersion = record.schemaVersion;
    const validEnums = (profileData.textSize === "standard" || profileData.textSize === "large" || profileData.textSize === "extraLarge") &&
        (profileData.buttonSize === "standard" || profileData.buttonSize === "large") &&
        (profileData.contrast === "standard" || profileData.contrast === "high") &&
        (profileData.guideDelaySeconds === 10 || profileData.guideDelaySeconds === 15 || profileData.guideDelaySeconds === 20);
    const validBooleans = typeof profileData.easyLanguage === "boolean" &&
        typeof profileData.smartGuide === "boolean" &&
        typeof profileData.voiceGuidance === "boolean";
    if (!validEnums || !validBooleans)
        throw new Error("QR_UNAVAILABLE");
    if (schemaVersion < 3) {
        if (typeof profileData.bottomControls !== "boolean")
            throw new Error("QR_UNAVAILABLE");
        const { simplifiedLayout: _legacySimplifiedLayout, ...supportedPreferences } = profileData;
        return validateAccessibilityProfile({
            ...supportedPreferences,
            viewportMode: null,
            language: "ko",
            stepByStepGuidance: false,
            conciseGuidance: false,
            slowGuidance: false,
        });
    }
    if ("bottomControls" in profileData || "simplifiedLayout" in profileData)
        throw new Error("QR_UNAVAILABLE");
    const viewportMode = profileData.viewportMode;
    const validViewportMode = viewportMode === null ||
        (viewportMode !== null && typeof viewportMode === "object" && !Array.isArray(viewportMode) &&
            viewportMode.mode === "bottom" &&
            [60, 70, 80].includes(viewportMode.heightPercent));
    if (!validViewportMode)
        throw new Error("QR_UNAVAILABLE");
    if (typeof profileData.textSize !== "string" ||
        typeof profileData.buttonSize !== "string" ||
        typeof profileData.contrast !== "string" ||
        typeof profileData.guideDelaySeconds !== "number" ||
        !("viewportMode" in profileData)) {
        throw new Error("QR_UNAVAILABLE");
    }
    if (schemaVersion === 4) {
        if (!PROFILE_LANGUAGES.includes(profileData.language) ||
            typeof profileData.stepByStepGuidance !== "boolean" ||
            typeof profileData.conciseGuidance !== "boolean" ||
            typeof profileData.slowGuidance !== "boolean") {
            throw new Error("QR_UNAVAILABLE");
        }
    }
    return validateAccessibilityProfile({
        ...profileData,
        bottomControls: false,
        ...(schemaVersion === 3 ? {
            language: "ko",
            stepByStepGuidance: false,
            conciseGuidance: false,
            slowGuidance: false,
        } : {}),
    });
}
export function createQrProfileClient(options = {}) {
    const fetcher = options.fetcher ?? fetch;
    let controller = null;
    return {
        get loading() { return controller !== null; },
        cancel() { controller?.abort(); controller = null; },
        async resolve(value, inputKind = "manual") {
            if (controller)
                throw new Error("PROFILE_REQUEST_IN_PROGRESS");
            const token = inputKind === "scan" ? getScannedProfileToken(value) : getManualProfileToken(value);
            if (!token)
                throw new Error("QR_UNAVAILABLE");
            const request = new AbortController();
            controller = request;
            try {
                const response = await fetcher(PROFILE_ENDPOINT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                    signal: request.signal,
                });
                if (request.signal.aborted)
                    throw new DOMException("Aborted", "AbortError");
                const body = await response.json().catch(() => null);
                if (request.signal.aborted)
                    throw new DOMException("Aborted", "AbortError");
                if (!response.ok) {
                    if ([400, 404].includes(response.status))
                        throw new Error("QR_UNAVAILABLE");
                    throw new Error("PROFILE_LOOKUP_FAILED");
                }
                return profileFromCentralResponse(body);
            }
            finally {
                if (controller === request)
                    controller = null;
            }
        },
    };
}
//# sourceMappingURL=qr-profile.js.map