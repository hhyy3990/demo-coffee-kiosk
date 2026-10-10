import type { AccessibilityAdapter } from "./adapter.ts";
import { type AccessibilityDiagnostic } from "./diagnostics.ts";
import { type GuideState } from "./guide.ts";
import { type AccessibilityProfile } from "./profile.ts";
export interface AccessibilitySdkOptions {
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    onInteractionCount?: (count: number) => void;
    onDiagnostics?: (issues: readonly AccessibilityDiagnostic[]) => void;
    onSessionCleanupError?: (error: unknown) => void;
}
export type SessionCleanup = () => void;
export interface AccessibilitySdk {
    readonly version: string;
    readonly profile: AccessibilityProfile;
    applyProfile(input: unknown): AccessibilityProfile;
    setGuideState(state: GuideState): void;
    resetIdleTimer(): void;
    speak(text: string): boolean;
    inspectLayout(): AccessibilityDiagnostic[];
    endSession(): void;
    registerSessionCleanup(cleanup: SessionCleanup): () => void;
    createSessionGuard(): () => boolean;
    destroy(): void;
}
export declare function createAccessibilitySdk(options: AccessibilitySdkOptions): AccessibilitySdk;
