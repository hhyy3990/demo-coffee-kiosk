import type { AccessibilityAdapter } from "./adapter.ts";
export declare const DEFAULT_PRIMARY_ACTION_MESSAGE = "\uC544\uB798\uC5D0 \uB2E4\uC74C \uBC84\uD2BC\uC774 \uC788\uC2B5\uB2C8\uB2E4. \uD654\uBA74\uC744 \uC704\uB85C \uBC00\uC5B4\uBCF4\uC138\uC694.";
export declare function createScrollGuidance(root: HTMLElement, adapter: AccessibilityAdapter): {
    refresh: () => void;
    setEnabled(value: boolean): void;
    clear(): void;
    destroy(): void;
};
