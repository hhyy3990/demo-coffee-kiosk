import type { AccessibilityAdapter } from "./adapter.ts";
export type AccessibilityIssueType = "text-clipped" | "horizontal-overflow" | "action-offscreen" | "bottom-control-obscures-action" | "small-touch-target" | "action-overlap";
export interface AccessibilityDiagnostic {
    screenId: string;
    semanticId: string;
    relatedSemanticId?: string;
    issueType: AccessibilityIssueType;
    measurements: Readonly<Record<string, number | boolean>>;
}
export interface LayoutDiagnosticOptions {
    minimumTouchTarget?: number;
}
export declare function inspectKioskLayout(root: HTMLElement, adapter: AccessibilityAdapter, options?: LayoutDiagnosticOptions): AccessibilityDiagnostic[];
