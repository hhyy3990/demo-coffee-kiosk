import { BrowserQRCodeReader } from "@zxing/browser";
import { Camera, CameraOff, QrCode, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ScannerControls = Awaited<ReturnType<BrowserQRCodeReader["decodeFromVideoDevice"]>>;
type ScannerPhase = "idle" | "starting" | "scanning" | "detected" | "error";

interface QrCameraScannerProps {
  disabled?: boolean;
  onScan: (value: string) => void;
  onCameraUnavailable: (message: string) => void;
  onRestart: () => void;
}

function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "카메라 사용 권한이 없어요. 브라우저에서 권한을 허용하거나 주소를 직접 입력해 주세요.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "사용할 수 있는 카메라가 없어요. 주소를 직접 입력해 주세요.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "카메라를 사용할 수 없어요. 다른 앱을 닫거나 주소를 직접 입력해 주세요.";
  }
  return "카메라를 시작하지 못했어요. 주소를 직접 입력해 주세요.";
}

export default function QrCameraScanner({
  disabled = false,
  onScan,
  onCameraUnavailable,
  onRestart,
}: QrCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const scanHandledRef = useRef(false);
  const [phase, setPhase] = useState<ScannerPhase>("idle");
  const [status, setStatus] = useState("QR 코드를 화면 가운데에 맞춰 주세요.");

  const stopCamera = useCallback((callbackControls?: ScannerControls) => {
    const controls = callbackControls ?? controlsRef.current;
    controlsRef.current = null;
    try {
      controls?.stop();
    } catch {
      // Stop each media track below as a second, direct camera-release safeguard.
    }

    const video = videoRef.current;
    const stream = video?.srcObject;
    if (typeof MediaStream !== "undefined" && stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    if (disabled || phase === "starting" || phase === "scanning") return;

    scanHandledRef.current = false;
    setPhase("starting");
    setStatus("카메라 권한을 확인하고 있어요.");

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message = "카메라 스캔은 HTTPS 연결에서만 사용할 수 있어요. 주소를 직접 입력해 주세요.";
      setPhase("error");
      setStatus(message);
      onCameraUnavailable(message);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      const message = "카메라 화면을 열 수 없어요. 주소를 직접 입력해 주세요.";
      setPhase("error");
      setStatus(message);
      onCameraUnavailable(message);
      return;
    }

    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 220,
      delayBetweenScanSuccess: 500,
      tryPlayVideoTimeout: 5000,
    });

    try {
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result, _error, callbackControls) => {
        if (!result || scanHandledRef.current) return;
        scanHandledRef.current = true;
        stopCamera(callbackControls);
        setPhase("detected");
        setStatus("QR을 읽었어요. 카메라를 종료하고 설정을 확인할게요.");
        onScan(result.getText());
      });

      controlsRef.current = controls;
      if (scanHandledRef.current) {
        stopCamera(controls);
      } else {
        setPhase("scanning");
        setStatus("QR 코드를 찾고 있어요. 코드를 테두리 안에 맞춰 주세요.");
      }
    } catch (error) {
      if (scanHandledRef.current) return;
      stopCamera();
      const message = cameraErrorMessage(error);
      setPhase("error");
      setStatus(message);
      onCameraUnavailable(message);
    }
  };

  const stopByUser = () => {
    scanHandledRef.current = true;
    stopCamera();
    setPhase("idle");
    setStatus("카메라를 껐어요.");
  };

  const restart = () => {
    stopCamera();
    scanHandledRef.current = false;
    setPhase("idle");
    setStatus("QR 코드를 화면 가운데에 맞춰 주세요.");
    onRestart();
  };

  return (
    <section className="qr-camera-panel" aria-label="카메라 QR 스캔">
      <div className={`qr-camera-stage ${phase === "scanning" ? "is-scanning" : ""}`}>
        <video
          ref={videoRef}
          className="qr-camera-video"
          autoPlay
          muted
          playsInline
          aria-label="카메라 미리보기"
        />
        {phase !== "scanning" && (
          <div className="qr-camera-placeholder" aria-hidden="true">
            <QrCode size={34} />
            <span>{phase === "detected" ? "스캔 완료" : "카메라 스캔 영역"}</span>
          </div>
        )}
        {phase === "scanning" && (
          <div className="qr-camera-frame" aria-hidden="true">
            <i /><i /><i /><i />
          </div>
        )}
      </div>

      <div className="qr-camera-instructions">
        <strong>QR 코드를 카메라에 보여 주세요</strong>
        <p>휴대전화 화면의 QR 전체가 테두리 안에 들어오도록 맞춰 주세요. 초점이 잡힐 때까지 잠시 기다리면 자동으로 읽어요.</p>
        <small>영상은 이 기기에서만 처리하며 저장하거나 서버로 보내지 않아요.</small>
      </div>

      <p className="qr-camera-status" role="status" aria-live="polite">{status}</p>

      <div className="qr-camera-actions">
        {(phase === "idle" || phase === "error") && (
          <button type="button" className="primary-button" onClick={() => void startCamera()} disabled={disabled}>
            <Camera size={19} aria-hidden="true" />
            {phase === "error" ? "카메라 다시 시도" : "카메라로 QR 스캔"}
          </button>
        )}
        {phase === "starting" && (
          <button type="button" className="primary-button" disabled>
            <Camera size={19} aria-hidden="true" /> 카메라 준비 중
          </button>
        )}
        {phase === "scanning" && (
          <button type="button" className="secondary-button" onClick={stopByUser}>
            <CameraOff size={18} aria-hidden="true" /> 카메라 끄기
          </button>
        )}
        {phase === "detected" && (
          <button type="button" className="secondary-button" onClick={restart} disabled={disabled}>
            <RotateCcw size={17} aria-hidden="true" /> 다시 스캔
          </button>
        )}
      </div>
    </section>
  );
}
