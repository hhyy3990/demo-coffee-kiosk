import type { AccessibilityAdapter } from "./adapter.ts";
import { type BottomViewportConfig } from "./bottom-viewport.ts";
import { type AccessibilityDiagnostic } from "./diagnostics.ts";
import { type LayoutCorrectionResult } from "./layout-enhancements.ts";
import { type GuideState } from "./guide.ts";
import { type AccessibilityProfile } from "./profile.ts";
import { type CompletionReturnCallback, type CompletionState } from "./completion.ts";
export interface AccessibilitySdkOptions {
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    /** Explicit opt-in; never inferred from the central QR profile. */
    viewportMode?: BottomViewportConfig;
    onInteractionCount?: (count: number) => void;
    onDiagnostics?: (issues: readonly AccessibilityDiagnostic[]) => void;
    onSessionCleanupError?: (error: unknown) => void;
}
export type SessionCleanup = () => void;
export interface AccessibilitySdk {
    readonly version: string;
    readonly profile: AccessibilityProfile;
    applyProfile(input: unknown): AccessibilityProfile;
    /** Notify only when the host commits a different business screen. */
    notifyScreenChange(screenId: string): boolean;
    setViewportMode(config: BottomViewportConfig | null): boolean;
    setGuideState(state: GuideState): void;
    beginCompletion(onReturn: CompletionReturnCallback): void;
    extendCompletion(): boolean;
    cancelCompletion(): void;
    finishCompletion(): Promise<void>;
    subscribeCompletion(listener: (state: CompletionState) => void): () => void;
    readonly completionState: CompletionState;
    resetIdleTimer(): void;
    speak(text: string): boolean;
    inspectLayout(): AccessibilityDiagnostic[];
    correctLayout(): LayoutCorrectionResult[];
    getLastLayoutCorrections(): LayoutCorrectionResult[];
    endSession(): void;
    registerSessionCleanup(cleanup: SessionCleanup): () => void;
    createSessionGuard(): () => boolean;
    destroy(): void;
}
export declare const GUIDE_AUTO_DISMISS_MS = 10000;
export declare function createAccessibilitySdk(options: AccessibilitySdkOptions): AccessibilitySdk;
