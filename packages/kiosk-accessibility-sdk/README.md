# 내 방식 QR 키오스크 접근성 SDK

웹 키오스크용 프레임워크 비종속 TypeScript/JavaScript 패키지입니다. SDK는 프로필 검증, 화면 표현, 무조작 감지, 스마트 길잡이, 추가 메뉴 안내, 브라우저 음성, 레이아웃 진단·보정을 담당합니다. 주문·결제·진료 등의 업무 상태나 버튼 실행은 각 키오스크가 계속 소유합니다.

## 현재 버전

- 패키지: `@naebangsik/kiosk-accessibility-sdk`
- SDK API: `0.5.14`
- 중앙 QR 프로필: v1·v2·v3·v4 읽기 지원, v3/v4에서 명시적 `viewportMode` 적용
- 런타임 의존성: `@zxing/browser` (QR 스캐너 선택 모듈에서만 사용)
- 패키지 형식: ES module JavaScript + TypeScript 선언 파일 + 별도 CSS

## 통합 안내 패널 (0.5.13)

호스트는 각 업무 화면의 쉬운 설명만 제공합니다. SDK는 같은 안내 패널에서 페이지 이동과 접기/펼치기를 처리하며, 스마트 길잡이가 뜨면 해당 패널을 잠시 길잡이 문구로 바꾼 뒤 현재 쉬운 설명 페이지로 되돌립니다. SDK는 업무 동작을 실행하거나 자동 번역하지 않습니다.

```ts
sdk.applyProfile(profile); // easyLanguage가 true일 때만 쉬운 설명을 표시
sdk.setEasyLanguageState({
  stepId: "application.confirm",
  explanations: [
    { title: "수령 방법", text: "서류를 받을 방법을 선택합니다." },
    { title: "신청", text: "입력한 내용으로 발급을 시작합니다." },
  ],
});

// 단계 전환 뒤 새 화면 데이터가 준비되면 새 설명을 전달합니다.
sdk.notifyScreenChange("application.payment");
sdk.setEasyLanguageState({
  stepId: "application.payment",
  explanations: [{ title: "결제", text: "표시된 금액을 확인합니다." }],
});
```

설명은 호스트가 제공한 텍스트 그대로 안전하게 표시됩니다. 단계 변경 시 이전 설명을 비우고 새 설명은 첫 페이지부터 시작합니다. 스마트 길잡이는 표시 후 기본 10초, `slowGuidance` 적용 시 15초 후 닫힙니다. 기존 `guideDelaySeconds` 10·15·20초는 표시 전 대기 시간입니다.

## 빌드와 패키지 만들기

데모커피 저장소 루트에서 실행합니다.

```sh
npm run sdk:build
npm run sdk:pack
npm run sdk:verify-consumer
npm --prefix packages/kiosk-accessibility-sdk run test:browser
npm --prefix packages/kiosk-accessibility-sdk run test:browser:viewport
```

빌드 결과는 `packages/kiosk-accessibility-sdk/dist/`에 생성됩니다. `sdk:pack`은 사전 빌드 후 다음 파일을 생성합니다. `sdk:verify-consumer`는 tarball을 별도 임시 프로젝트에 설치하고 공개 타입 선언 검사와 독립 Vite 프로덕션 번들을 확인합니다.

```text
packages/kiosk-accessibility-sdk/releases/naebangsik-kiosk-accessibility-sdk-0.5.14.tgz
```

버전을 바꿀 때는 `package.json`의 버전과 공개 상수 `ACCESSIBILITY_SDK_VERSION`을 함께 변경하세요. v1·v2·v3의 기존 동작을 유지하고 신규 선호 4개는 기본값으로 고정합니다. v3/v4는 최상위 `schemaVersion`, `updatedAt`, `preferences`와 명시적 `viewportMode`를 요구하며 `null` 또는 `{ mode: "bottom", heightPercent: 60 | 70 | 80 }`만 허용합니다. v4에서는 `language`(ko/zh/vi/en/th/uz/ja) 및 `stepByStepGuidance`, `conciseGuidance`, `slowGuidance`를 필수 검증하고 SDK 프로필로 노출합니다. 이 값은 호스트가 읽을 수 있도록 보존할 뿐 자동 번역이나 새로운 안내 UI를 실행하지 않습니다. 잘못된 신규 값, 미지원 스키마, 레거시 `simplifiedLayout`은 거부합니다. `guideDelaySeconds`는 기존처럼 표시 전 대기 시간입니다.

## 다른 Replit 프로젝트에 가져오기

1. 이 프로젝트의 파일 패널에서 `packages/kiosk-accessibility-sdk/releases/naebangsik-kiosk-accessibility-sdk-0.5.14.tgz`를 다운로드합니다.
2. 대상 Replit 프로젝트의 파일 패널로 tarball을 업로드합니다.
3. 대상 프로젝트 Shell에서 업로드한 경로를 지정해 설치합니다.

```sh
npm install ./naebangsik-kiosk-accessibility-sdk-0.5.14.tgz
```

프로젝트 코드에서 런타임, 타입, 스타일을 가져옵니다.

```ts
import {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  ACCESSIBILITY_SDK_VERSION,
  createAccessibilitySdk,
  createQrProfileClient,
  PROFILE_LANGUAGES,
  type ProfileLanguage,
  type BottomViewportConfig,
  validateAccessibilityProfile,
  type AccessibilityAdapter,
  type AccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
```

## 첫 화면 전용 QR 도크

`createQrEntryDock()`은 호스트가 명시적으로 `active`를 켠 동안만 SDK 소유 QR 버튼을 화면 아래에 표시합니다. 호스트는 QR 화면 열기 콜백과 현재 레이아웃 어댑터를 제공하고, 화면이 바뀌면 `setActive(false)`로 도크를 제거합니다. SDK는 화면 이름을 추측하거나 호스트 DOM을 옮기지 않습니다. 고정 하단 버튼은 어댑터의 `getLayoutRegions().bottomControls`에 등록해야 안전한 공간을 계산할 수 있습니다.

```ts
import { createQrEntryDock } from "@naebangsik/kiosk-accessibility-sdk";

const dock = createQrEntryDock({
  root,
  adapter,
  active: isWelcomeScreen,
  onOpenQr: openExistingQrDialog,
  theme: { button: "#704b32", buttonForeground: "#fffaf1" },
});

// 호스트 화면 상태가 바뀔 때 호출
dock.setActive(isWelcomeScreen);
// 호스트가 종료될 때
dock.destroy();
```

QR 프로필의 v3 `viewportMode`는 SDK가 방법 B와 첫 화면 QR 도크의 하단 모드를 함께 동기화합니다. 기존처럼 `createQrEntryDock()`을 한 번 만들고 호스트 화면 전환에 맞춰 `setActive()`를 호출하면 됩니다. `createQrEntryDock({ bottomViewportPercent })`를 명시한 개발 모드는 QR 프로필보다 우선하며, 프로필의 `viewportMode: null` 또는 `endSession()`은 프로필 기반 도크 모드를 일반 모드로 돌립니다. 주문 또는 진료 등 업무 상태와 QR 모달 진입 권한은 계속 호스트가 관리합니다.

## 방법 B: 아래쪽 표시 영역

방법 B는 페이지나 글씨를 축소하지 않고, 등록한 화면 루트를 고정 QR 도크와 등록된 하단 조작부를 제외한 가용 높이의 아래쪽 60%, 70%, 80% 스크롤 영역으로 표시합니다. 기존 중앙 QR 프로필 v1/v2의 `bottomControls` 값으로는 활성화되지 않습니다. v3 QR 프로필의 `preferences.viewportMode`가 SDK 적용 시 자동 반영되며, 개발·호스트 제어를 위해 공개 `setViewportMode()`도 유지합니다.

```ts
import type { BottomViewportConfig } from "@naebangsik/kiosk-accessibility-sdk";

const mode: BottomViewportConfig = { mode: "bottom", heightPercent: 70 };
const sdk = createAccessibilitySdk({ root, adapter, viewportMode: mode });

// 같은 인스턴스에서 비율 변경 또는 해제
sdk.setViewportMode({ mode: "bottom", heightPercent: 60 });
sdk.setViewportMode(null);
```

일반 QR 적용 흐름에서는 호스트가 기존 중앙 API 응답을 `createQrProfileClient().resolve(...)`로 검증한 뒤 그 결과를 `sdk.applyProfile(profile)`에 전달하면 됩니다. SDK는 v3 응답을 검증하고 `viewportMode`를 같은 내부 레이아웃 경로에 적용합니다. 호스트가 QR 적용 경로에서 별도로 `setViewportMode()`를 호출할 필요는 없습니다. v1/v2 응답은 `viewportMode: null`로 정규화됩니다.

허용 비율은 `60 | 70 | 80`뿐입니다. 잘못된 값은 TypeScript 타입에서 거부되고 런타임에서도 화면을 바꾸지 않고 `false`를 반환합니다. 모드 해제와 `endSession()`은 SDK가 추가한 클래스 및 CSS 사용자 속성을 복원하며, 주문·발급 등 호스트 상태는 변경하지 않습니다.

`getLayoutRegions().scrollArea`가 root 안에 있으면 그 영역을 스크롤 대상으로 사용합니다. 이를 등록하지 않으면 root 자체가 대상으로 사용됩니다. 실제 문서 스크롤의 경우 root를 업무 화면 전체를 담는 루트로 등록해야 합니다. 고정 버튼은 기존 `bottomControls` 배열로, SDK가 만든 첫 화면 QR 도크는 SDK가 직접 측정합니다. QR 카메라·키패드·모달은 `viewportOverlays`로 선택 등록하세요. 특별한 고정 요소나 복잡한 중첩 스크롤의 의미가 불분명하면 SDK가 추측하지 않습니다.

```ts
getLayoutRegions: () => ({
  scrollArea: root.querySelector<HTMLElement>("[data-a11y-slot='scroll-content']"),
  bottomControls: [...root.querySelectorAll<HTMLElement>("[data-a11y-slot='bottom-controls']")],
  viewportOverlays: [...root.querySelectorAll<HTMLElement>("[data-a11y-viewport-overlay]")],
}),
```

SDK는 기존 DOM 자식을 옮기지 않으며, 업무 버튼을 실행·삭제·숨김 처리하지 않습니다. CSS가 화면 자체를 축소하는 방식은 쓰지 않습니다. root가 화면 외부에 있거나, transform/contain/복잡한 중첩 스크롤이 fixed positioning을 가로막는 구조는 별도 검증이 필요합니다.

패키지는 React나 데모커피 파일을 참조하지 않습니다. 브라우저 DOM을 제공하는 웹 키오스크와 ES module을 처리할 수 있는 번들러가 필요합니다. 프로필 검증 유틸리티는 Node.js에서도 사용할 수 있습니다.

## 아래쪽 메뉴 자동 안내

현재 화면의 목록을 `getLayoutRegions()`에서 선택적으로 `menuItems`에 등록하면 SDK가 해당 항목과 실제 스크롤 소유 영역을 측정합니다. 추가 항목이 아래에 있고 사용자가 더 내릴 수 있을 때만 SDK가 안내 UI를 표시합니다. 자체 스크롤과 문서 스크롤을 모두 지원하며, 고정 하단 조작부와 등록된 버튼을 피할 수 없는 상태에서는 안내를 가리지 않고 스크롤 불가 진단을 남깁니다.

기본 문구는 `아래에도 내용이 있어요`이며, 등록된 주요 버튼이 화면 아래에 있을 때는 `아래에도 버튼이 있어요`를 씁니다. 기존 `menuMessage`와 액션별 안내문은 호환용 입력으로 남아 있지만 공통 문구 정책에 따라 표시하지 않습니다. 안내는 실제 세로 스크롤이 남아 있을 때만 표시되며, 자동 음성은 재생하지 않습니다.

```ts
getLayoutRegions: () => ({
  scrollArea: root.querySelector<HTMLElement>("[data-a11y-slot='scroll-content']"),
  bottomControls: [root.querySelector<HTMLElement>("[data-a11y-slot='bottom-controls']")!],
  menuItems: [...root.querySelectorAll<HTMLElement>("[data-a11y-menu-item]")],
  // menuMessage is retained for source compatibility; SDK guidance uses shared copy.
}),
```

## 스크롤 안내 선택과 우선순위

세로 스크롤 안내는 실제 문서 또는 내부 스크롤 컨테이너의 위치와 남은 스크롤 거리를 기준으로 표시합니다. `primaryActions`에는 화면 아래에 있는 중요한 버튼을 선택 등록할 수 있으며, 실제로 아래로 이동할 수 있을 때만 공통 버튼 안내를 표시합니다.

안내는 기본적으로 화면에 나타난 뒤 10초 후 자동으로 닫히며 강조 효과도 함께 제거됩니다. 표시 유지 시간은 SDK 내부 기본값 10초이며 사용자 설정은 제공하지 않습니다(따라서 15초를 초과하지 않습니다). `guideDelaySeconds`는 안내가 나타나기 전 대기 시간(10·15·20초)이며 변경되지 않습니다. 안전하게 배치할 빈 공간이 부족하면 QR 도크·하단 고정 조작부·명시적 회피 영역은 피하고, 가능한 작업 영역 안에서 일반 버튼과 겹치는 후보 중 가장 덜 겹치는 위치를 선택합니다. 표시할 작업 영역 자체가 72px보다 작으면 잘린 안내 대신 표시 실패를 반환합니다.

기존 수평 목록의 이동 버튼은 `aria-controls`로 실제 가로 스크롤 목록을 연결하고 접근성 이름에 “다음/이전 + 메뉴·항목·목록” 의미를 제공하세요. 식별이 모호한 경우 `horizontalNavigation`에 목록과 두 버튼을 명시적으로 연결할 수 있습니다. SDK는 이미 존재하는 버튼만 최대 5초간 부드럽게 강조하며 누르거나 생성하지 않습니다. 같은 세션에서 이미 안내한 방향은 반복하지 않고, `endSession()`에서 상태와 타이머를 초기화합니다. reduced-motion 환경에서는 정적인 강조를 짧게 표시합니다.

안내는 `pointer-events:none`이며 기존 조작을 가로막지 않습니다. 일반 콘텐츠와 일부 겹칠 수 있지만, 등록한 하단 고정 조작부·회피 영역·스마트 길잡이는 피합니다. 세로 이동이 끝나면 숨기고, 다시 위로 이동하면 재표시합니다.

SDK는 등록된 root 안의 보이는 텍스트 leaf와 일반 입력 컨트롤을 자동 탐색해 글씨 크기를 조정하며, `getTextTargets()`로 명시적 텍스트 대상을 추가할 수 있습니다. 숨김 요소와 SVG·이미지·canvas·SDK 안내 UI는 제외합니다. 선택 스위치 등 조작 요소는 `getActions()`에 의미 있는 실제 요소를 등록합니다. SDK는 선택 상태나 label을 변경하지 않고, 요소 자체의 hit area 확장은 호스트가 제공합니다.

실제 가로 스크롤 목록에서 다음 위치가 남아 있는 기존 버튼은 `aria-label`에 다음/next와 목록 의미(카테고리·메뉴·항목 등)를 제공하고 `aria-controls`로 해당 목록을 연결하면 SDK가 시각적으로 강조합니다. SDK는 해당 버튼을 만들거나 누르지 않습니다. 가로 스크롤 안내 문구는 표시하지 않습니다.

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
    reflowContainers: [root.querySelector<HTMLElement>("[data-a11y-slot='scroll-content']")!],
    gridContainers: [...root.querySelectorAll<HTMLElement>("[data-a11y-grid]")],
    actionGroups: [...root.querySelectorAll<HTMLElement>("[data-a11y-action-group]")],
  }),
};

const sdk = createAccessibilitySdk({ root, adapter });
```

화면이 실제 업무 단계로 바뀐 뒤 호스트는 프레임워크와 관계없이 새 화면 ID를 한 번 전달합니다. `notifyScreenChange()`는 ID가 바뀐 경우에만 이전·현재 스크롤 소유자를 다시 측정하고 초기화하며, 이전 길잡이 타이머와 안내도 취소합니다. 같은 ID의 재렌더링, 입력 변경, 모달 및 길잡이는 스크롤 초기화로 통지하지 않습니다.

```ts
// DOM을 새 화면으로 갱신한 직후 호출합니다.
sdk.notifyScreenChange(`service.${hostStep}`);

// React에서는 화면 ID만 dependency로 둡니다.
useLayoutEffect(() => {
  sdk.notifyScreenChange(screenId);
}, [sdk, screenId]);
```

SDK는 다음 animation frame에서 하단 viewport/QR 도크를 갱신한 다음 문서와 등록된 스크롤 영역 중 실제 소유자를 판정합니다. 안정화는 짧게 제한하고, 도중에 사용자가 입력을 시작하면 늦은 초기화를 취소합니다. `endSession()`은 진행 중인 초기화와 기억한 화면 ID를 지우므로, 호스트는 복귀한 첫 화면을 다시 통지합니다.

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

## 업무 완료 후 처음 화면 복귀

호스트가 실제 완료를 확정한 뒤 `beginCompletion()`을 호출합니다. SDK는 15초 카운트다운, 초 단위 상태 구독, 시간 연장, 취소, 수동 복귀를 관리합니다. 완료 콜백은 호스트의 첫 화면 이동과 업무 데이터 초기화를 수행합니다. 완료 화면을 떠나거나 `endSession()`을 호출하면 타이머는 취소됩니다. SDK는 업무 완료 여부를 추론하지 않으며 주문·발급 데이터를 직접 변경하지 않습니다.

```ts
const unsubscribe = sdk.subscribeCompletion((state) => {
  renderCompletionTimer(state.remainingSeconds, state.active, state.error);
});

// 실제 완료 화면에서, 영수증 등 후속 처리가 끝난 뒤:
sdk.beginCompletion(() => {
  resetHostOrderState();
  sdk.endSession();
  showHostWelcomeScreen();
});

// 완료 화면 버튼:
sdk.extendCompletion(); // 15초로 다시 시작
void sdk.finishCompletion(); // 즉시 호스트 복귀 콜백

// 완료 화면을 다른 업무 화면으로 떠날 때:
sdk.cancelCompletion();
unsubscribe();
```

복귀 콜백이 `false`를 반환하거나 오류를 던지면 자동 재시도하지 않습니다. 상태는 오류로 남아 사용자가 수동 복귀를 다시 시도할 수 있습니다. 카운트다운은 실제 마감 시각 기준이므로 백그라운드 탭에서도 여러 타이머가 중복 실행되지 않습니다.

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
  // 같은 화면 안의 확인 모달처럼 새 업무 안내 단계마다 바꿉니다.
  // ID에는 개인정보나 입력값을 넣지 않습니다.
  stepId: "bank.review.confirm",
  enabled: profile.smartGuide,
  paused: false,
  delaySeconds: profile.guideDelaySeconds,
  message: {
    title: "다음 단계",
    text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
    actionId: "bank.review.continue",
  },
});

// 같은 stepId에서 옵션/수량에 따라 message만 바뀌면 기존 타이머를 유지합니다.

const layoutIssues = sdk.inspectLayout(); // 읽기 전용 진단
const corrections = sdk.correctLayout(); // 명시된 영역에서만 보정 시도, 결과별 되돌림 여부 반환
const automaticCorrections = sdk.getLastLayoutCorrections(); // 프로필 적용 시 자동 보정 결과
```

기존 React 앱에서는 화면 해제 시 `sdk.destroy()`를 호출합니다. `destroy()`는 `endSession()` 정리 후 SDK 이벤트 리스너까지 해제하고 처음의 root 클래스 상태를 복원합니다. 업무 상태는 변경하지 않습니다.

```ts
sdk.destroy();
```

## 공통 확대·제한적 레이아웃 보정

글씨 크기는 root 안에서 탐색한 텍스트와 명시적으로 등록한 대상을 각 요소의 현재 반응형 원본 크기 기준으로 1.25배/1.5배 처리하고, 큰 글씨에서 14px/16px 최소 크기를 적용합니다. `ResizeObserver`와 창 크기 변경을 함께 감지해 뷰포트 또는 키오스크 루트의 너비가 바뀌면 기존 보정 스타일을 되돌린 뒤 반응형 CSS 기준을 다시 측정합니다. 크기 변경 중 확대가 누적되지 않으며, QR 프로필 해제·`endSession()`·`destroy()`에서 원래 스타일을 복원합니다. 화면이 다시 렌더링되면 SDK가 새 대상을 찾아 현재 프로필을 적용합니다.

### 보조 안내 문구의 선택적 글씨 보정

글씨를 줄일 수 있는 대상은 호스트가 `getFontCorrectionTargets()`에 등록한 요소뿐입니다. 대상은 `getTextTargets()`에도 등록해 의미 ID로 진단할 수 있게 합니다. 버튼·입력·링크·live region·업무 액션 하위의 텍스트는 자동 보정에서 제외됩니다. 메뉴명, 금액, 법적·개인정보 안내 같은 중요 텍스트는 등록하지 마세요. SDK는 의미를 추측할 수 없으므로 호스트의 명시적 등록이 안전 경계입니다.

```ts
getTextTargets: () => [
  { id: "help.subtitle", element: helpSubtitle },
],
getFontCorrectionTargets: () => [
  { id: "help.subtitle", element: helpSubtitle },
],
```

프로필 확대 후 실제 잘림 또는 등록된 고정 조작부와의 겹침이 있을 때만 먼저 5%를 줄여 다시 측정하고, 해소되지 않으면 최대 10%까지 한 번 더 시도합니다. 두 시도 뒤에도 문제가 있으면 원래 프로필 확대 크기와 line-height로 복원하고 `failed` 결과와 레이아웃 진단을 남깁니다. 문제가 없으면 글씨를 줄이지 않습니다. 자동 줄바꿈은 이 기능에서 강제하지 않습니다.

### 개발자용 읽기 전용 레이아웃 진단

`sdk.inspectLayout()`을 명시적으로 호출할 때만 진단 배열을 반환합니다. SDK는 진단 UI나 콘솔 출력을 자동 표시하지 않습니다. 결과에는 의미 ID, 유형, 요소 태그·좌표, 뷰포트, 현재 프로필, 심각도, 권장 확인 사항 및 보정 상태가 포함되며 사용자 입력값은 수집하지 않습니다.

대상 바깥의 스타일은 수정하지 않습니다. `getLayoutRegions()`에서 호스트가 명시한 `reflowContainers`, `gridContainers`, `actionGroups`, `scrollArea`만 보정 후보가 됩니다. 텍스트 줄바꿈/높이 유연화, 최소 너비 해제, 가로 넘침 시 그리드 1열 전환을 시도합니다. 고정 하단 조작부와 등록된 스크롤 영역의 실제 교차 높이를 측정해 여백을 더하고, 마지막 등록 액션을 최대 스크롤 위치로 예상했을 때 가림 진단이 해소되지 않으면 적용하지 않습니다. 스크롤 자체가 불가능하거나 안전한 여백을 계산할 수 없는 경우 `failed` 결과를 보고합니다. 버튼 겹침은 의미 ID 쌍으로 진단하며, 보정 전후 진단 결과가 나아지지 않거나 새 문제가 생기면 해당 변경을 되돌립니다. `correctLayout()`은 각 전략과 적용/롤백 결과를 반환하고, 자동 시도 결과는 `getLastLayoutCorrections()`에서 확인할 수 있습니다.

절대 위치 요소, 복잡한 중첩 스크롤, 캔버스/iframe 내부, 호스트 규칙 간 우선순위 충돌 등은 일반 규칙만으로 안전하게 재배치할 수 없습니다. 자동 보정은 감지한 모든 문제의 해결을 보장하지 않으며, 메뉴·업무 버튼을 숨기거나 클릭하지 않습니다. AI 연결은 포함하지 않습니다.

향후 중앙 AI 서비스가 스마트 길잡이 문구를 제공하더라도 응답은 호스트의 현재 화면과 허용된 행동 ID에 한정해야 합니다. 호스트가 응답을 검증한 뒤 `setGuideState`에 전달하며, AI나 SDK가 버튼을 누르거나 업무 상태를 변경하지 않도록 유지합니다. 현재 중앙 AI 연결은 포함되어 있지 않습니다.
