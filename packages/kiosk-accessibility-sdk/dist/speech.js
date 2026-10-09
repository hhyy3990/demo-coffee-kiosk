export function cancelSpeech() {
    if (typeof window === "undefined" || !("speechSynthesis" in window))
        return;
    try {
        window.speechSynthesis.cancel();
    }
    catch {
        // Voice guidance is optional.
    }
}
export function speakText(text, enabled, language = "ko-KR", rate = 0.92) {
    if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window))
        return false;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language;
        utterance.rate = rate;
        window.speechSynthesis.speak(utterance);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=speech.js.map