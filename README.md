# DemoCoffee Kiosk

2026 AI Life Solutions Challenge를 위한 데모커피 키오스크입니다. 중앙의 ‘내 방식 QR’ 범용 접근성 프로필을 적용해 키오스크 화면을 이용하는 흐름을 시연합니다.

## 주요 기능

- QR 접근성 설정 적용
- 큰 글씨, 큰 버튼, 고대비 표시
- 스마트 길잡이와 스크롤 안내
- 결제 없는 모의 주문 흐름
- 특정 G 프로필의 메뉴 화면에서 중앙 AI Layout v2를 통한 OpenAI 연동 및 사전 검증된 두 레이아웃 후보 지원:
  - `large-card-row`
  - `single-column-list`

실제 AI 선택 결과는 별도로 확인되지 않았습니다.

## 기술 스택

- React 19, TypeScript, Vite
- Express 5, Node.js
- Tailwind CSS 4
- Zod, ZXing Browser, Lucide React
- 데모커피 키오스크 접근성 SDK 패키지

## 로컬 실행

Node.js와 npm이 설치된 환경에서 실행합니다.

```bash
npm ci
npm run dev
```

개발 서버는 기본적으로 포트 `5000`을 사용합니다. 추가 검증 명령은 다음과 같습니다.

```bash
npm run typecheck
npm test
npm run build
```

## 환경변수 이름

아래는 코드에서 사용하는 환경변수 이름입니다. 실제 값은 이 저장소에 포함하지 마세요. 비밀 값은 Replit Secrets 등 안전한 비밀 저장소에서 관리하세요.

### 서버 및 AI Layout

- `AI_LAYOUT_CENTRAL_URL`
- `AI_LAYOUT_RELAY_ENABLED`
- `AI_LAYOUT_RELAY_ONE_SHOT`
- `AI_LAYOUT_REPLIT_EXTERNAL_TOKEN`
- `AI_LAYOUT_SERVICE_TOKEN`
- `QR_PROFILE_PRODUCTION_ACCESS_TOKEN`
- `UNIVERSAL_LAYOUT_OPENAI_MAX_UPSTREAM_REQUESTS`
- `UNIVERSAL_LAYOUT_V2_PRODUCTION_AI_ENABLED`
- `UNIVERSAL_LAYOUT_V2_PRODUCTION_EXTERNAL_ACCESS_TOKEN`
- `UNIVERSAL_LAYOUT_V2_PRODUCTION_HOST_TOKEN`

### 클라이언트 빌드 설정

- `VITE_DEMO_COFFEE_AI_LAYOUT_AUTO`
- `VITE_DEMO_COFFEE_AI_LAYOUT_MOCK`
- `VITE_DEMO_COFFEE_AI_LAYOUT_OPENAI`
- `VITE_DEMO_COFFEE_AI_LAYOUT_PRODUCTION_AUTO`

### 실행 및 브라우저 테스트

- `NODE_ENV`
- `PORT`
- `CHROMIUM_PATH`
- `DEMOCOFFEE_URL`
- `MENU_LAYOUT_ENV_MOCK_TEST`

## 공개 데모

https://demokeopikioseukeu.replit.app
