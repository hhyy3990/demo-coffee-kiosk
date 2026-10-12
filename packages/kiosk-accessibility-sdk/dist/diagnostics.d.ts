import type { AccessibilityAdapter } from "./adapter.ts";
export type AccessibilityIssueType = "text-clipped" | "text-obscured" | "horizontal-overflow" | "action-offscreen" | "bottom-control-obscures-action" | "last-scroll-action-obscured" | "small-touch-target" | "action-overlap" | "menu-overflow-unreachable";
export interface AccessibilityDiagnostic {
    screenId: string;
    semanticId: string;
    relatedSemanticId?: string;
    issueType: AccessibilityIssueType;
    measurements: Readonly<Record<string, number | boolean>>;
    severity?: "warning" | "error";
    elementTag?: string;
    elementRect?: Readonly<{
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    }>;
    viewport?: Readonly<{
        width: number;
        height: number;
    }>;
    profile?: Readonly<{
        textSize: string;
        buttonSize: string;
        contrast: string;
        viewportMode: number | null;
    }>;
    recommendation?: string;
    autoCorrection?: "applied" | "failed" | "not-attempted";
    reason?: "target-overflow" | "ancestor-overflow" | "line-clamp" | "fixed-button" | "qr-button";
}
export interface LayoutDiagnosticOptions {
    minimumTouchTarget?: number;
}
export declare function inspectKioskLayout(root: HTMLElement, adapter: AccessibilityAdapter, options?: LayoutDiagnosticOptions): AccessibilityDiagnostic[];
