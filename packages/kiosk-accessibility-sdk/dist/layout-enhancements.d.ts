import type { AccessibilityAdapter } from "./adapter.ts";
import type { AccessibilityProfile } from "./profile.ts";
export interface LayoutCorrectionResult {
    strategy: "text-wrap" | "release-container-width" | "reduce-grid-columns" | "reserve-scroll-space" | "stack-action-group";
    outcome: "applied" | "reverted" | "not-needed";
    issuesBefore: number;
    issuesAfter: number;
}
export declare function createLayoutEnhancer(root: HTMLElement, adapter: AccessibilityAdapter, getProfile: () => AccessibilityProfile): {
    applyProfile(): void;
    correctLayout(): LayoutCorrectionResult[];
    getLastCorrections(): LayoutCorrectionResult[];
    restore(): void;
    destroy(): void;
};
