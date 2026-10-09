import type { AccessibilityGuideMessage } from "./adapter";

export type GuideDelaySeconds = 10 | 15 | 20;

export interface IdleTimerDriver {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: IdleTimerDriver = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function smartGuideDelayMs(seconds: GuideDelaySeconds): number {
  return seconds * 1000;
}

export function createIdleTimer(
  onIdle: () => void,
  driver: IdleTimerDriver = browserTimers,
) {
  let handle: unknown = null;
  let disposed = false;

  const clear = () => {
    if (handle === null) return;
    driver.clear(handle);
    handle = null;
  };

  return {
    reset(delayMs: number) {
      clear();
      if (disposed || !Number.isFinite(delayMs) || delayMs < 0) return;
      handle = driver.set(() => {
        handle = null;
        if (!disposed) onIdle();
      }, delayMs);
    },
    cancel: clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}

export interface GuideState {
  enabled: boolean;
  paused: boolean;
  delaySeconds: GuideDelaySeconds;
  message: AccessibilityGuideMessage | null;
}
