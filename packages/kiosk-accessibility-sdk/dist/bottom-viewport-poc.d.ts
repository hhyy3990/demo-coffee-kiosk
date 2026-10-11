import type { AccessibilityAdapter } from "./adapter.ts";
export type BottomViewportPocPercent = 60 | 70 | 80;
export interface BottomViewportPocOptions {
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    percent: BottomViewportPocPercent;
}
export interface QrEntryAreaPocOptions {
    root: HTMLElement;
    onOpenQr(): void;
    adapter?: AccessibilityAdapter;
    percent?: BottomViewportPocPercent;
    label?: string;
}
/**
 * Experimental bottom viewport shell. It changes the scroll owner without moving
 * host nodes; the host remains responsible for deciding when the experiment ends.
 */
export declare function createBottomViewportPoc({ root, adapter, percent, }: BottomViewportPocOptions): {
    destroy(): void;
};
/**
 * Experimental SDK-owned QR entry area. The host decides when it is mounted
 * and supplies only the existing QR-opening action; no host DOM is moved.
 */
export declare function createQrEntryAreaPoc({ root, onOpenQr, adapter, percent, label, }: QrEntryAreaPocOptions): {
    destroy(): void;
};
