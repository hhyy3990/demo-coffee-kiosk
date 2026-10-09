export function cancelSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Voice guidance is optional.
  }
}

export function speakText(
  text: string,
  enabled: boolean,
  language = "ko-KR",
  rate = 0.92,
): boolean {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = rate;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
