import { BrowserQRCodeReader } from "@zxing/browser";
const cameraMessage = (error) => {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError")
        return "카메라 사용 권한이 없어요. 브라우저에서 권한을 허용하거나 주소를 직접 입력해 주세요.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError")
        return "사용할 수 있는 카메라가 없어요. 주소를 직접 입력해 주세요.";
    if (name === "NotReadableError" || name === "TrackStartError")
        return "카메라를 사용할 수 없어요. 다른 앱을 닫거나 주소를 직접 입력해 주세요.";
    return "카메라를 시작하지 못했어요. 주소를 직접 입력해 주세요.";
};
export function mountQrScanner(options) {
    const { container } = options;
    container.innerHTML = `<section class="qr-camera-panel" aria-label="카메라 QR 스캔">
    <div class="qr-camera-stage"><video class="qr-camera-video" autoplay muted playsinline aria-label="카메라 미리보기"></video>
      <div class="qr-camera-placeholder" aria-hidden="true"><span>QR 스캔 영역</span></div></div>
    <div class="qr-camera-instructions"><strong>QR 코드를 카메라에 보여 주세요</strong>
      <p>휴대전화 화면의 QR 전체가 테두리 안에 들어오도록 맞춰 주세요. 초점이 잡힐 때까지 기다리면 자동으로 읽어요.</p>
      <small>영상은 이 기기에서만 처리하며 저장하거나 서버로 보내지 않아요.</small></div>
    <p class="qr-camera-status" role="status" aria-live="polite">QR 코드를 화면 가운데에 맞춰 주세요.</p>
    <div class="qr-camera-actions"><button type="button" class="primary-button">카메라로 QR 스캔</button></div>
  </section>`;
    const video = container.querySelector("video");
    const status = container.querySelector(".qr-camera-status");
    const button = container.querySelector(".qr-camera-actions button");
    let controls = null;
    let handled = false;
    let destroyed = false;
    const stop = () => {
        try {
            controls?.stop();
        }
        catch { /* Track cleanup below is the fallback. */ }
        controls = null;
        const stream = video.srcObject;
        if (typeof MediaStream !== "undefined" && stream instanceof MediaStream)
            stream.getTracks().forEach((track) => track.stop());
        video.pause();
        video.srcObject = null;
    };
    const start = async () => {
        if (destroyed || controls || button.disabled)
            return;
        handled = false;
        button.disabled = true;
        status.textContent = "카메라 권한을 확인하고 있어요.";
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            const message = "카메라 스캔은 HTTPS 연결에서만 사용할 수 있어요. 주소를 직접 입력해 주세요.";
            status.textContent = message;
            options.onCameraUnavailable(message);
            button.disabled = false;
            return;
        }
        try {
            const reader = options.readerFactory?.() ?? new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 220, delayBetweenScanSuccess: 500 });
            const nextControls = await reader.decodeFromVideoDevice(undefined, video, (result, _error, callbackControls) => {
                if (!result || handled || destroyed)
                    return;
                handled = true;
                controls = callbackControls;
                stop();
                status.textContent = "QR을 읽었어요. 카메라를 종료하고 설정을 확인할게요.";
                button.textContent = "다시 스캔";
                options.onScan(result.getText());
            });
            if (handled || destroyed) {
                if (!handled)
                    nextControls.stop();
                return;
            }
            controls = nextControls;
            button.disabled = false;
            button.textContent = "카메라 끄기";
            status.textContent = "QR 코드를 찾고 있어요. 코드를 화면 가운데에 맞춰 주세요.";
        }
        catch (error) {
            stop();
            const message = cameraMessage(error);
            status.textContent = message;
            button.disabled = false;
            options.onCameraUnavailable(message);
        }
    };
    button.addEventListener("click", () => {
        if (controls) {
            handled = true;
            stop();
            button.textContent = "카메라로 QR 스캔";
            status.textContent = "카메라를 껐어요.";
            return;
        }
        void start();
    });
    return {
        start,
        stop,
        destroy() {
            destroyed = true;
            handled = true;
            stop();
            container.replaceChildren();
        },
    };
}
//# sourceMappingURL=qr-scanner.js.map