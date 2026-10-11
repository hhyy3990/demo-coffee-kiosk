import type { AccessibilityAdapter } from "./adapter.ts";
export declare const DEFAULT_ADDITIONAL_MENU_MESSAGE = "\uC544\uB798\uC5D0\uB3C4 \uB0B4\uC6A9\uC774 \uC788\uC5B4\uC694";
export interface AdditionalMenuOverflowState {
    itemCount: number;
    hiddenCount: number;
    hasMoreBelow: boolean;
    canScrollBelow: boolean;
    unreachable: boolean;
    clipBottom: number;
    scrollOwner: HTMLElement | Document | null;
}
export declare function analyzeAdditionalMenuOverflow(root: HTMLElement, adapter: AccessibilityAdapter): AdditionalMenuOverflowState;
export declare function createAdditionalMenuHint(root: HTMLElement, adapter: AccessibilityAdapter): {
    refresh(): void;
    clear(): void;
    destroy(): void;
};
