import type { AccessibilityGuideMessage } from "./adapter.ts";
export type GuideDelaySeconds = 10 | 15 | 20;
export interface IdleTimerDriver {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}
export declare function smartGuideDelayMs(seconds: GuideDelaySeconds): number;
export declare function createIdleTimer(onIdle: () => void, driver?: IdleTimerDriver): {
    reset(delayMs: number): void;
    cancel: () => void;
    dispose(): void;
};
export interface GuideState {
    enabled: boolean;
    paused: boolean;
    delaySeconds: GuideDelaySeconds;
    message: AccessibilityGuideMessage | null;
}
