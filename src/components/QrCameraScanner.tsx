import { useEffect, useRef } from "react";
import type { QrScannerHandle } from "@naebangsik/kiosk-accessibility-sdk/qr-scanner";

interface QrCameraScannerProps {
  disabled?: boolean;
  onScan: (value: string) => void;
  onCameraUnavailable: (message: string) => void;
  onRestart: () => void;
  registerSessionCleanup?: (cleanup: () => void) => () => void;
}

export default function QrCameraScanner({
  disabled = false,
  onScan,
  onCameraUnavailable,
  registerSessionCleanup,
}: QrCameraScannerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<QrScannerHandle | null>(null);
  const callbacksRef = useRef({ onScan, onCameraUnavailable, disabled });
  callbacksRef.current = { onScan, onCameraUnavailable, disabled };

  useEffect(() => {
    let cancelled = false;
    let sessionEnded = false;
    void import("@naebangsik/kiosk-accessibility-sdk/qr-scanner").then(({ mountQrScanner }) => {
      if (cancelled || sessionEnded || !mountRef.current) return;
      scannerRef.current = mountQrScanner({
        container: mountRef.current,
        onScan: (value) => callbacksRef.current.onScan(value),
        onCameraUnavailable: (message) => callbacksRef.current.onCameraUnavailable(message),
      });
    }).catch(() => callbacksRef.current.onCameraUnavailable("카메라 스캔 모듈을 불러오지 못했어요. 주소를 직접 입력해 주세요."));
    const unregisterSessionCleanup = registerSessionCleanup?.(() => {
      sessionEnded = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    });
    return () => {
      cancelled = true;
      unregisterSessionCleanup?.();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    const button = mountRef.current.querySelector<HTMLButtonElement>(".qr-camera-actions button");
    if (button) button.disabled = disabled;
    if (disabled) scannerRef.current?.stop();
  }, [disabled]);

  return <div ref={mountRef} />;
}
