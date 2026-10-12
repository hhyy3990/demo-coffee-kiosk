import type { AccessibilityAdapter } from "./adapter.ts";
import type { AccessibilityProfile } from "./profile.ts";
export interface LayoutCorrectionResult {
    strategy: "text-wrap" | "release-container-width" | "reduce-grid-columns" | "reserve-scroll-space" | "stack-action-group" | "supporting-copy-font";
    outcome: "applied" | "reverted" | "not-needed" | "failed";
    issuesBefore: number;
    issuesAfter: number;
    reason?: "scroll-unavailable" | "no-safe-inset" | "clipping-remains" | "fixed-control-overlap-remains";
    targetId?: string;
    fontSizeBefore?: number;
    fontSizeAfter?: number;
    attempts?: readonly {
        reductionPercent: 5 | 10;
        fontSize: number;
        lineHeight: number | null;
        remainingIssueTypes: readonly string[];
        maxOverlapWidth?: number;
        maxOverlapHeight?: number;
    }[];
}
export declare function createLayoutEnhancer(root: HTMLElement, adapter: AccessibilityAdapter, getProfile: () => AccessibilityProfile): {
    applyProfile(): void;
    correctLayout(): LayoutCorrectionResult[];
    getLastCorrections(): LayoutCorrectionResult[];
    restore(): void;
    destroy(): void;
};
