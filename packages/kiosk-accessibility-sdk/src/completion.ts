export const DEFAULT_COMPLETION_SECONDS = 15;

export interface CompletionState {
  active: boolean;
  returning: boolean;
  remainingSeconds: number;
  error: boolean;
}

export type CompletionReturnCallback = () => void | boolean | Promise<void | boolean>;
const INACTIVE: CompletionState = { active: false, returning: false, remainingSeconds: 0, error: false };

export function createCompletionController(onChange: (state: CompletionState) => void) {
  let state = { ...INACTIVE };
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let returnCallback: CompletionReturnCallback | null = null;
  let lastTick = -1;
  const listeners = new Set<(state: CompletionState) => void>();
  const emit = () => {
    const snapshot = { ...state };
    onChange(snapshot);
    listeners.forEach((listener) => listener(snapshot));
  };
  const clearTimer = () => {
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = null;
  };
  const schedule = (id: number) => {
    clearTimer();
    timer = globalThis.setTimeout(() => tick(id), Math.min(250, Math.max(1, deadline - Date.now())));
  };
  const tick = (id: number) => {
    if (id !== generation || !state.active || state.returning) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining !== lastTick) {
      state = { ...state, remainingSeconds: remaining };
      lastTick = remaining;
      emit();
    }
    if (remaining === 0) void finishCompletion(id);
    else schedule(id);
  };
  const finishCompletion = async (id = generation) => {
    if (id !== generation || !state.active || state.returning || !returnCallback) return;
    clearTimer();
    state = { ...state, returning: true, error: false, remainingSeconds: 0 };
    emit();
    try {
      const result = await returnCallback();
      if (result === false) throw new Error("Completion return callback did not complete");
      if (id !== generation) return;
      state = { ...INACTIVE };
      returnCallback = null;
      emit();
    } catch {
      if (id !== generation) return;
      state = { active: true, returning: false, remainingSeconds: 0, error: true };
      emit();
    }
  };
  return {
    get state(): CompletionState { return { ...state }; },
    subscribe(listener: (next: CompletionState) => void) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    begin(callback: CompletionReturnCallback) {
      this.cancel();
      generation += 1;
      returnCallback = callback;
      deadline = Date.now() + DEFAULT_COMPLETION_SECONDS * 1000;
      lastTick = -1;
      state = { active: true, returning: false, remainingSeconds: DEFAULT_COMPLETION_SECONDS, error: false };
      emit();
      schedule(generation);
    },
    extend() {
      if (!state.active || state.returning) return false;
      deadline = Date.now() + DEFAULT_COMPLETION_SECONDS * 1000;
      lastTick = -1;
      state = { ...state, remainingSeconds: DEFAULT_COMPLETION_SECONDS, error: false };
      emit();
      schedule(generation);
      return true;
    },
    cancel() {
      generation += 1;
      clearTimer();
      returnCallback = null;
      if (state.active || state.returning || state.error) {
        state = { ...INACTIVE };
        lastTick = -1;
        emit();
      }
    },
    finish() { return finishCompletion(); },
    dispose() { this.cancel(); listeners.clear(); },
  };
}
