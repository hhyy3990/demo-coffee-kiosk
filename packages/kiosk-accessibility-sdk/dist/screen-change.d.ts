import type { AccessibilityAdapter } from "./adapter.ts";
export type KioskScreenId = string;
export interface ScreenChangeController {
    notify(screenId: KioskScreenId): boolean;
    reset(): void;
    destroy(): void;
}
export declare function createScreenChangeController(root: HTMLElement, adapter: AccessibilityAdapter, refreshLayout: () => void): ScreenChangeController;
