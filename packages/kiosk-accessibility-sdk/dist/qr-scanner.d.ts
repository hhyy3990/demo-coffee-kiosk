import { BrowserQRCodeReader } from "@zxing/browser";
export interface QrScannerOptions {
    container: HTMLElement;
    onScan(value: string): void;
    onCameraUnavailable(message: string): void;
    readerFactory?: () => Pick<BrowserQRCodeReader, "decodeFromVideoDevice">;
}
export interface QrScannerHandle {
    start(): Promise<void>;
    stop(): void;
    destroy(): void;
}
export declare function mountQrScanner(options: QrScannerOptions): QrScannerHandle;
