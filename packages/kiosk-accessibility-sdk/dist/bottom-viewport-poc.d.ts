import type { AccessibilityAdapter } from "./adapter.ts";
export type BottomViewportPocPercent = 60 | 70 | 80;
export interface BottomViewportPocOptions {
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    percent: BottomViewportPocPercent;
}
/**
 * Experimental bottom viewport shell. It changes the scroll owner without moving
 * host nodes; the host remains responsible for deciding when the experiment ends.
 */
export declare function createBottomViewportPoc({ root, adapter, percent, }: BottomViewportPocOptions): {
    destroy(): void;
};
