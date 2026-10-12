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
    let generation = 0;
    const clear = () => {
        generation += 1;
        if (handle !== null)
            driver.clear(handle);
        handle = null;
    };
    return {
        reset(delayMs) {
            clear();
            if (disposed || !Number.isFinite(delayMs) || delayMs < 0)
                return;
            const scheduledGeneration = generation;
            handle = driver.set(() => {
                if (disposed || scheduledGeneration !== generation)
                    return;
                handle = null;
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