import type { AccessibilityAdapter } from "./adapter.ts";
import { type AccessibilityDiagnostic } from "./diagnostics.ts";
import { type GuideState } from "./guide.ts";
import { type AccessibilityProfile } from "./profile.ts";
export interface AccessibilitySdkOptions {
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    onInteractionCount?: (count: number) => void;
    onDiagnostics?: (issues: readonly AccessibilityDiagnostic[]) => void;
}
export interface AccessibilitySdk {
    readonly version: string;
    readonly profile: AccessibilityProfile;
    applyProfile(input: unknown): AccessibilityProfile;
    setGuideState(state: GuideState): void;
    resetIdleTimer(): void;
    speak(text: string): boolean;
    inspectLayout(): AccessibilityDiagnostic[];
    destroy(): void;
}
export declare function createAccessibilitySdk(options: AccessibilitySdkOptions): AccessibilitySdk;
