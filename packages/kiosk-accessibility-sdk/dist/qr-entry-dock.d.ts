import type { AccessibilityAdapter } from "./adapter.ts";
import type { BottomViewportHeightPercent } from "./bottom-viewport.ts";
export interface QrEntryDockTheme {
    surface?: string;
    foreground?: string;
    button?: string;
    buttonForeground?: string;
}
export interface QrEntryDockOptions {
    /** Host-owned kiosk root. The SDK never moves or edits its children. */
    root: HTMLElement;
    adapter: AccessibilityAdapter;
    /** Explicit host signal; the SDK does not infer screen names or routes. */
    active: boolean;
    onOpenQr(): void;
    label?: string;
    theme?: QrEntryDockTheme;
    /** Optional first-screen viewport ratio, measured after dock and controls. */
    bottomViewportPercent?: BottomViewportHeightPercent;
}
export interface QrEntryDockController {
    setActive(active: boolean): void;
    destroy(): void;
}
/** Creates an SDK-owned QR entry dock whose active state is controlled by the host. */
export declare function createQrEntryDock(options: QrEntryDockOptions): QrEntryDockController;
