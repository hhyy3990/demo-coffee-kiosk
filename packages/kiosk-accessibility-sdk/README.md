# 내 방식 QR 키오스크 접근성 SDK

웹 키오스크용 프레임워크 비종속 TypeScript/JavaScript 패키지입니다. SDK는 프로필 검증, 화면 표현, 무조작 감지, 스마트 길잡이 표시, 브라우저 음성, 읽기 전용 레이아웃 진단만 담당합니다. 주문·결제·진료 등의 업무 상태나 버튼 실행은 각 키오스크가 계속 소유합니다.

## 현재 버전

- 패키지: `@naebangsik/kiosk-accessibility-sdk`
- SDK API: `0.2.1`
- 프로필 스키마: `1.0.0` (중앙 QR 프로필의 기존 필드와 값 유지)
- 런타임 의존성: `@zxing/browser` (QR 스캐너 선택 모듈에서만 사용)
- 패키지 형식: ES module JavaScript + TypeScript 선언 파일 + 별도 CSS

## 빌드와 패키지 만들기

데모커피 저장소 루트에서 실행합니다.

```sh
npm run sdk:build
npm run sdk:pack
npm run sdk:verify-consumer
```

빌드 결과는 `packages/kiosk-accessibility-sdk/dist/`에 생성됩니다. `sdk:pack`은 사전 빌드 후 다음 파일을 생성합니다. `sdk:verify-consumer`는 tarball을 별도 임시 프로젝트에 설치하고 공개 타입 선언 검사와 독립 Vite 프로덕션 번들을 확인합니다.

```text
packages/kiosk-accessibility-sdk/releases/naebangsik-kiosk-accessibility-sdk-0.2.1.tgz
```

버전을 바꿀 때는 `package.json`의 버전과 공개 상수 `ACCESSIBILITY_SDK_VERSION`을 함께 변경하고, 중앙 프로필 필드나 값을 임의로 변경하지 마세요. 이 SDK는 npm에 게시하지 않아도 로컬 tarball로 설치할 수 있습니다.

## 다른 Replit 프로젝트에 가져오기

1. 이 프로젝트의 파일 패널에서 `packages/kiosk-accessibility-sdk/releases/naebangsik-kiosk-accessibility-sdk-0.2.1.tgz`를 다운로드합니다.
2. 대상 Replit 프로젝트의 파일 패널로 tarball을 업로드합니다.
3. 대상 프로젝트 Shell에서 업로드한 경로를 지정해 설치합니다.

```sh
npm install ./naebangsik-kiosk-accessibility-sdk-0.2.1.tgz
```

프로젝트 코드에서 런타임, 타입, 스타일을 가져옵니다.

```ts
import {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  ACCESSIBILITY_SDK_VERSION,
  createAccessibilitySdk,
  createQrProfileClient,
  validateAccessibilityProfile,
  type AccessibilityAdapter,
  type AccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
```

패키지는 React나 데모커피 파일을 참조하지 않습니다. 브라우저 DOM을 제공하는 웹 키오스크와 ES module을 처리할 수 있는 번들러가 필요합니다. 프로필 검증 유틸리티는 Node.js에서도 사용할 수 있습니다.

## 최소 어댑터와 초기화

각 키오스크는 안정적인 화면 ID, 의미 ID가 있는 실제 버튼 요소, 진단할 텍스트 요소, 하단 조작 영역을 제공합니다. 아래 예시는 업무 버튼이 SDK에 의해 실행되지 않는 독립 호스트입니다.

```ts
const root = document.querySelector<HTMLElement>("#kiosk-root")!;
const continueButton = root.querySelector<HTMLButtonElement>("#continue")!;
root.classList.add("kiosk");

let hostStep = "review";
const adapter: AccessibilityAdapter = {
  getSnapshot: () => ({
    screenId: `bank.${hostStep}`,
    state: { step: hostStep }, // 개인 정보·토큰은 넣지 않습니다.
  }),
  getActions: () => [{
    id: "bank.review.continue",
    name: "계속",
    element: continueButton,
    enabled: !continueButton.disabled,
    primary: true,
  }],
  getTextTargets: () => [{
    id: "bank.review.heading",
    element: root.querySelector<HTMLElement>("[data-a11y-text]")!,
  }],
  getLayoutRegions: () => ({
    bottomControls: [root.querySelector<HTMLElement>("[data-a11y-slot='bottom-controls']")!],
    scrollArea: root.querySelector<HTMLElement>("[data-a11y-slot='scroll-content']"),
  }),
};

const sdk = createAccessibilitySdk({ root, adapter });
```

마크업에서 같은 의미 ID와 영역을 표시합니다.

```html
<main data-a11y-slot="scroll-content">
  <h1 data-a11y-text data-a11y-id="bank.review.heading">신청 내용을 확인해 주세요</h1>
  <button id="continue" data-a11y-action-id="bank.review.continue">계속</button>
</main>
<footer data-a11y-slot="bottom-controls">...</footer>
```

호스트는 QR 프로필 클라이언트를 사용해 공식 QR URL 또는 raw token을 검증하고, 고정된 same-origin `/api/qr-profile` 경로로만 조회합니다. 카메라 화면을 열 때만 스캐너 모듈을 동적으로 불러옵니다.

```ts
const qrClient = createQrProfileClient();
const isCurrentSession = sdk.createSessionGuard();
const profile: AccessibilityProfile = await qrClient.resolve(scannedOrTypedValue, "scan");
if (isCurrentSession()) sdk.applyProfile(profile);

// 사용자가 QR 모달을 닫으면 진행 중 요청을 취소합니다.
qrClient.cancel();
```

업무가 끝나면 호스트가 먼저 업무별 데이터(주문·발급 단계·입력값)를 초기화하고, 공통 접근성 세션을 종료합니다.

```ts
const unregisterQrCleanup = sdk.registerSessionCleanup(() => {
  qrClient.cancel(); // 호스트가 만든 요청만 정리
  scanner?.destroy(); // 호스트가 만든 스캐너만 정리
  scanner = null;
});

function finishKioskTask() {
  clearHostOrderOrApplicationState();
  sdk.endSession();
}

// 호스트가 unmount될 때:
unregisterQrCleanup();
sdk.destroy();
```

`endSession()`은 등록된 정리 콜백, 스마트 길잡이 타이머·안내·강조, 음성, SDK 접근성 클래스와 프로필을 초기화하지만 SDK 인스턴스와 이벤트 리스너는 유지합니다. 새 업무에서 만든 비동기 요청은 시작 전에 `createSessionGuard()`를 캡처하고 응답 적용 전에 확인하세요. 세션 종료 후 콜백은 `false`를 반환합니다. QR 요청·카메라를 SDK가 만들지 않았다면 SDK가 직접 접근하지 않으며, 호스트가 `registerSessionCleanup()`으로 정리할 리소스만 등록합니다.

카메라 스캐너는 별도 entrypoint입니다. SDK 기본 entrypoint에서 ZXing 모듈을 가져오지 않으며, QR UI를 표시할 때만 동적 import 하세요.

```ts
const { mountQrScanner } = await import("@naebangsik/kiosk-accessibility-sdk/qr-scanner");
const scanner = mountQrScanner({
  container: scannerElement,
  onScan: (qrText) => void qrClient.resolve(qrText, "scan"),
  onCameraUnavailable: (message) => showManualInput(message),
});
// QR 화면을 닫거나 언마운트할 때:
scanner.destroy();
```

카메라 영상은 브라우저 내에서만 처리됩니다. 서버에는 QR 원문 URL이 아니라 검증된 token만 same-origin 중계 요청에 포함됩니다. 중계 서버와 비밀키는 호스트가 관리합니다.

호스트가 스마트 길잡이 문구와 기존 화면 행동 ID를 결정합니다. SDK는 안내를 표시하고 지정된 요소를 강조할 뿐, 행동을 호출하지 않습니다.

```ts
sdk.setGuideState({
  enabled: profile.smartGuide,
  paused: false,
  delaySeconds: profile.guideDelaySeconds,
  message: {
    title: "다음 단계",
    text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
    actionId: "bank.review.continue",
  },
});

const layoutIssues = sdk.inspectLayout(); // 읽기 전용 결과
```

기존 React 앱에서는 화면 해제 시 `sdk.destroy()`를 호출합니다. `destroy()`는 `endSession()` 정리 후 SDK 이벤트 리스너까지 해제하고 처음의 root 클래스 상태를 복원합니다. 업무 상태는 변경하지 않습니다.

```ts
sdk.destroy();
```

## 자동 적용 범위와 한계

SDK는 글씨·버튼 크기, 고대비 색상 토큰, 표시된 보조 정보의 단순화, 하단 조작 영역 배치 규칙을 제공합니다. 텍스트 잘림·가로 넘침·화면 밖 버튼·하단 영역 가림·작은 터치 영역은 측정해 보고합니다.

각 호스트는 자기 화면 구조에 맞는 반응형 그리드, 실제 스크롤 영역, 하단 영역 오프셋, 선택 가능한 행동 ID와 화면별 안내를 연결해야 합니다. 진단 결과로 DOM을 재배치하거나 AI가 업무 코드를 수정하는 동작은 없습니다. 일부 CSS는 호스트의 변수·마크업 표시에 의존하며, SDK만으로 모든 키오스크 화면을 자동으로 재구성하지 않습니다.

향후 중앙 AI 서비스가 스마트 길잡이 문구를 제공하더라도 응답은 호스트의 현재 화면과 허용된 행동 ID에 한정해야 합니다. 호스트가 응답을 검증한 뒤 `setGuideState`에 전달하며, AI나 SDK가 버튼을 누르거나 업무 상태를 변경하지 않도록 유지합니다. 현재 중앙 AI 연결은 포함되어 있지 않습니다.
