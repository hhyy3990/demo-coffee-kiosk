import { type AccessibilityProfile } from "./profile.ts";
export declare const CENTRAL_QR_ORIGIN = "https://naebangsikqr.replit.app";
export declare function isValidProfileToken(value: string): boolean;
export declare function getScannedProfileToken(value: string): string;
export declare function getManualProfileToken(value: string): string;
export interface QrProfileClient {
    resolve(value: string, inputKind?: "scan" | "manual"): Promise<AccessibilityProfile>;
    cancel(): void;
    readonly loading: boolean;
}
export declare function createQrProfileClient(options?: {
    fetcher?: typeof fetch;
}): QrProfileClient;
