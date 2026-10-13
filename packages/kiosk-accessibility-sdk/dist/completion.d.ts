export declare const DEFAULT_COMPLETION_SECONDS = 15;
export interface CompletionState {
    active: boolean;
    returning: boolean;
    remainingSeconds: number;
    error: boolean;
}
export type CompletionReturnCallback = () => void | boolean | Promise<void | boolean>;
export declare function createCompletionController(onChange: (state: CompletionState) => void): {
    readonly state: CompletionState;
    subscribe(listener: (next: CompletionState) => void): () => boolean;
    begin(callback: CompletionReturnCallback): void;
    extend(): boolean;
    cancel(): void;
    finish(): Promise<void>;
    dispose(): void;
};
