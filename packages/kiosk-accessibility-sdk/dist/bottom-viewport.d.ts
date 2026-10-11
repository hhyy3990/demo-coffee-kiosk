import type { AccessibilityAdapter } from "./adapter.ts";
export type BottomViewportHeightPercent = 60 | 70 | 80;
export interface BottomViewportConfig {
    mode: "bottom";
    heightPercent: BottomViewportHeightPercent;
}
export declare function createBottomViewportController(root: HTMLElement, adapter: AccessibilityAdapter): {
    apply(input: BottomViewportConfig | null): boolean;
    refresh(): void;
    destroy(): void;
};
