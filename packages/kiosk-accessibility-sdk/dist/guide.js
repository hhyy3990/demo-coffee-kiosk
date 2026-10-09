const browserTimers = {
    set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clear: (handle) => globalThis.clearTimeout(handle),
};
export function smartGuideDelayMs(seconds) {
    return seconds * 1000;
}
export function createIdleTimer(onIdle, driver = browserTimers) {
    let handle = null;
    let disposed = false;
    const clear = () => {
        if (handle === null)
            return;
        driver.clear(handle);
        handle = null;
    };
    return {
        reset(delayMs) {
            clear();
            if (disposed || !Number.isFinite(delayMs) || delayMs < 0)
                return;
            handle = driver.set(() => {
                handle = null;
                if (!disposed)
                    onIdle();
            }, delayMs);
        },
        cancel: clear,
        dispose() {
            disposed = true;
            clear();
        },
    };
}
//# sourceMappingURL=guide.js.map