import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Contrast,
  HandHelping,
  QrCode,
  ScanLine,
  Type,
  X,
} from "lucide-react";
import "./CafeWelcome.css";

type Panel = "settings" | "help" | null;
type SettingsStep = "choices" | "qr";
type OrderType = "store" | "takeout";

export function CafeWelcome() {
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsStep, setSettingsStep] = useState<SettingsStep>("choices");
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [qrValue, setQrValue] = useState("");
  const [qrMessage, setQrMessage] = useState("");

  useEffect(() => {
    if (!panel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panel]);

  const openSettings = () => {
    setSettingsStep("choices");
    setQrMessage("");
    setPanel("settings");
  };

  const chooseOrderType = (choice: OrderType) => {
    setOrderType(choice);
  };

  const applyDemoPreset = () => {
    setLargeText(true);
    setHighContrast(true);
  };

  const submitQr = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQrMessage(
      qrValue.trim()
        ? "이 미리보기에서는 설정을 불러오지 않아요."
        : "QR 주소 또는 토큰을 입력해 주세요.",
    );
  };

  return (
    <main
      className={`cw-screen${largeText ? " cw-large-text" : ""}${highContrast ? " cw-high-contrast" : ""}`}
    >
      <div className="cw-page">
        <header className="cw-header">
          <div className="cw-brand" aria-label="데모커피 DEMO COFFEE">
            <span className="cw-brand-mark" aria-hidden="true">
              <Coffee size={23} strokeWidth={1.8} />
            </span>
            <span className="cw-brand-copy">
              <strong>데모커피</strong>
              <span>DEMO COFFEE</span>
            </span>
          </div>
          <div className="cw-header-note">
            <span className="cw-open-dot" aria-hidden="true" />
            편안하게 골라 주세요
          </div>
        </header>

        <section className="cw-welcome" aria-labelledby="cw-title">
          <div className="cw-copy">
            <div className="cw-overline">
              <span className="cw-overline-rule" />
              잠깐의 여유를 준비할게요
            </div>
            <h1 id="cw-title">오늘도 향긋한 한 잔</h1>
            <p className="cw-description">맛있는 커피와 편안한 시간을 선사합니다.</p>

            <div className="cw-order-block">
              <p className="cw-prompt">먼저 이용 방법을 골라 주세요</p>
              <div className="cw-order-actions">
                <button
                  type="button"
                  className={`cw-order-button cw-dine-in${orderType === "store" ? " is-selected" : ""}`}
                  onClick={() => chooseOrderType("store")}
                  aria-pressed={orderType === "store"}
                >
                  <span>매장 이용</span>
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`cw-order-button cw-takeout${orderType === "takeout" ? " is-selected" : ""}`}
                  onClick={() => chooseOrderType("takeout")}
                  aria-pressed={orderType === "takeout"}
                >
                  <span>포장하기</span>
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </div>
              <p className="cw-order-feedback" aria-live="polite">
                {orderType
                  ? `${orderType === "store" ? "매장 이용" : "포장하기"}를 선택했어요.`
                  : "원하는 방식으로 천천히 시작해 보세요."}
              </p>
            </div>
          </div>

          <div className="cw-photo-wrap">
            <img
              className="cw-coffee-photo"
              src="/__mockup/images/democoffee-welcome-cup.jpg"
              alt="라떼 아트가 담긴 크림색 도자기 커피잔"
            />
            <div className="cw-photo-caption">
              <span className="cw-caption-icon" aria-hidden="true">
                <Coffee size={17} />
              </span>
              <span>
                <strong>오늘의 한 잔</strong>
                <small>따뜻한 커피 한 잔의 여유</small>
              </span>
            </div>
            <span className="cw-photo-index" aria-hidden="true">01 / 01</span>
          </div>
        </section>

        <footer className="cw-footer">
          <span className="cw-footer-note">도움이 필요하면 언제든 말씀해 주세요</span>
          <nav className="cw-secondary-actions" aria-label="추가 도움">
            <button type="button" className="cw-quiet-action" onClick={openSettings}>
              <span className="cw-quiet-icon" aria-hidden="true"><Type size={17} /></span>
              편한 화면 설정
            </button>
            <span className="cw-footer-divider" aria-hidden="true" />
            <button type="button" className="cw-quiet-action" onClick={() => setPanel("help")}>
              <span className="cw-quiet-icon" aria-hidden="true"><HandHelping size={17} /></span>
              직원 도움
            </button>
          </nav>
        </footer>
      </div>

      {panel && (
        <div
          className="cw-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPanel(null);
          }}
        >
          <section
            className={`cw-panel${panel === "help" ? " cw-help-panel" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cw-panel-title"
          >
            <div className="cw-panel-heading">
              <div>
                <span className="cw-panel-kicker">{panel === "settings" ? "화면 설정" : "직원 도움"}</span>
                <h2 id="cw-panel-title">
                  {panel === "help"
                    ? "도움이 필요하신가요?"
                    : settingsStep === "qr"
                      ? "QR로 설정 불러오기"
                      : "편한 화면으로 바꿔 보세요"}
                </h2>
                <p>
                  {panel === "help"
                    ? "가까운 직원에게 화면을 보여 주시면 안내해 드릴게요."
                    : settingsStep === "qr"
                      ? "QR 코드의 주소 또는 설정 토큰을 입력해 주세요."
                      : "원하는 방법을 선택하면 바로 화면에 적용돼요."}
                </p>
              </div>
              <button
                type="button"
                className="cw-close-button"
                onClick={() => setPanel(null)}
                aria-label="닫기"
              >
                <X size={20} />
              </button>
            </div>

            {panel === "help" ? (
              <div className="cw-help-content">
                <div className="cw-help-note">
                  <span className="cw-help-mark" aria-hidden="true"><HandHelping size={22} /></span>
                  <span>직원이 필요한 순간, 편하게 불러 주세요.</span>
                </div>
                <button type="button" className="cw-panel-primary cw-full-button" onClick={() => setPanel(null)}>
                  확인했어요
                  <Check size={18} aria-hidden="true" />
                </button>
              </div>
            ) : settingsStep === "choices" ? (
              <div className="cw-settings-content">
                <button
                  type="button"
                  className="cw-setting-choice"
                  onClick={() => {
                    setQrMessage("");
                    setSettingsStep("qr");
                  }}
                >
                  <span className="cw-setting-icon"><QrCode size={21} /></span>
                  <span className="cw-setting-copy">
                    <strong>내 QR로 설정 불러오기</strong>
                    <small>저장해 둔 화면 설정을 이어서 사용해요</small>
                  </span>
                  <ArrowRight className="cw-setting-arrow" size={19} />
                </button>

                <button
                  type="button"
                  className={`cw-setting-choice${largeText ? " is-active" : ""}`}
                  onClick={() => setLargeText((current) => !current)}
                  aria-pressed={largeText}
                >
                  <span className="cw-setting-icon"><Type size={21} /></span>
                  <span className="cw-setting-copy">
                    <strong>큰 글씨로 이용하기</strong>
                    <small>{largeText ? "큰 글씨가 적용되어 있어요" : "화면의 글자를 더 편하게 읽어요"}</small>
                  </span>
                  <span className={`cw-toggle${largeText ? " is-on" : ""}`} aria-hidden="true"><span /></span>
                </button>

                <button
                  type="button"
                  className={`cw-setting-choice${highContrast ? " is-active" : ""}`}
                  onClick={() => setHighContrast((current) => !current)}
                  aria-pressed={highContrast}
                >
                  <span className="cw-setting-icon"><Contrast size={21} /></span>
                  <span className="cw-setting-copy">
                    <strong>고대비 화면 사용하기</strong>
                    <small>{highContrast ? "고대비 화면이 적용되어 있어요" : "글자와 배경의 차이를 또렷하게"}</small>
                  </span>
                  <span className={`cw-toggle${highContrast ? " is-on" : ""}`} aria-hidden="true"><span /></span>
                </button>

                <div className="cw-preset-row">
                  <span>화면을 빠르게 맞추고 싶다면</span>
                  <button type="button" onClick={applyDemoPreset}>데모 설정 적용</button>
                </div>
                <button type="button" className="cw-panel-text-action" onClick={() => setPanel(null)}>
                  설정을 마쳤어요
                  <Check size={17} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="cw-qr-content">
                <button
                  type="button"
                  className="cw-back-action"
                  onClick={() => {
                    setQrMessage("");
                    setSettingsStep("choices");
                  }}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
                  설정 방법으로 돌아가기
                </button>
                <div className="cw-scan-hint">
                  <span className="cw-scan-icon" aria-hidden="true"><ScanLine size={24} /></span>
                  <p><strong>QR 코드가 있다면</strong> 코드에 담긴 주소나 토큰을 아래에 입력해 주세요.</p>
                </div>
                <form className="cw-qr-form" onSubmit={submitQr}>
                  <label htmlFor="cw-qr-address">QR 주소 또는 토큰</label>
                  <input
                    id="cw-qr-address"
                    type="text"
                    value={qrValue}
                    onChange={(event) => {
                      setQrValue(event.target.value);
                      setQrMessage("");
                    }}
                    placeholder="주소나 토큰을 입력해 주세요"
                    autoComplete="off"
                  />
                  {qrMessage && <p className="cw-qr-message" role="status">{qrMessage}</p>}
                  <button type="submit" className="cw-panel-primary cw-full-button">
                    설정 불러오기
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
