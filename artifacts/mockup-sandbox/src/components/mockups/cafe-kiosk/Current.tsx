import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accessibility, ArrowLeft, ArrowRight, CakeSlice, Check, ChevronRight, Clock3, Coffee,
  Cookie, CreditCard, Croissant, Gift, GlassWater, HandHelping, Info, Minus, PackageCheck, Plus,
  QrCode, RotateCcw, ScanLine, ShoppingBag, Smartphone, Sparkles, Store, Ticket,
  Trash2, Volume2, VolumeX, X,
} from "lucide-react";
import "./_group.css";

type Stage = "start" | "menu" | "options" | "cart" | "payment" | "processing" | "complete";
type Category = "coffee" | "cake" | "dessert" | "food";
type Preferences = {
  textSize: "standard" | "large" | "extraLarge";
  buttonSize: "standard" | "large";
  contrast: "standard" | "high";
  easyLanguage: boolean;
  simplifiedLayout: boolean;
  bottomControls: boolean;
  smartGuide: boolean;
  voiceGuidance: boolean;
  guideDelaySeconds: 10 | 15 | 20;
};
type Product = {
  id: string;
  name: string;
  koreanName: string;
  price: number;
  category: Category;
  optionsSupported: boolean;
  icon: typeof Coffee;
  art: string;
  note: string;
  temperature?: "hot-iced" | "iced-only";
};
type OrderOptions = { temperature: string; size: "regular" | "large"; cup: "store" | "tumbler" };
type CartLine = { key: string; product: Product; quantity: number; options: OrderOptions };

const DEFAULT_PREFERENCES: Preferences = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  easyLanguage: false,
  simplifiedLayout: false,
  bottomControls: false,
  smartGuide: false,
  voiceGuidance: false,
  guideDelaySeconds: 15,
};
const DEMO_PREFERENCES: Preferences = {
  ...DEFAULT_PREFERENCES,
  textSize: "large",
  buttonSize: "large",
  contrast: "high",
  easyLanguage: true,
  simplifiedLayout: true,
  bottomControls: true,
  smartGuide: true,
  voiceGuidance: true,
  guideDelaySeconds: 10,
};
const PRODUCTS: Product[] = [
  { id: "americano", name: "Americano", koreanName: "아메리카노", price: 4200, category: "coffee", optionsSupported: true, icon: Coffee, art: "art-coffee", note: "깔끔하고 고소한 커피", temperature: "hot-iced" },
  { id: "latte", name: "Cafe Latte", koreanName: "카페라떼", price: 4800, category: "coffee", optionsSupported: true, icon: Coffee, art: "art-latte", note: "부드러운 우유와 에스프레소", temperature: "hot-iced" },
  { id: "vanilla-latte", name: "Vanilla Latte", koreanName: "바닐라 라떼", price: 5300, category: "coffee", optionsSupported: true, icon: Coffee, art: "art-latte", note: "은은한 바닐라 향", temperature: "hot-iced" },
  { id: "cold-brew", name: "Cold Brew", koreanName: "콜드브루", price: 4900, category: "coffee", optionsSupported: true, icon: GlassWater, art: "art-cold", note: "천천히 우려낸 깊은 맛", temperature: "iced-only" },
  { id: "lemon-tea", name: "Lemon Tea", koreanName: "레몬티", price: 4600, category: "coffee", optionsSupported: true, icon: GlassWater, art: "art-tea", note: "상큼하게 즐기는 차", temperature: "hot-iced" },
  { id: "cheesecake", name: "Cheesecake", koreanName: "뉴욕 치즈케이크", price: 6500, category: "cake", optionsSupported: false, icon: CakeSlice, art: "art-cake", note: "진한 치즈와 부드러운 결" },
  { id: "macaron", name: "Macaron", koreanName: "바닐라 마카롱", price: 2800, category: "dessert", optionsSupported: false, icon: Cookie, art: "art-macaron", note: "바삭하고 쫀득한 한입" },
  { id: "croissant", name: "Butter Croissant", koreanName: "버터 크루아상", price: 3900, category: "food", optionsSupported: false, icon: Croissant, art: "art-croissant", note: "겹겹이 구운 버터 풍미" },
  { id: "toast", name: "Garden Toast", koreanName: "가든 토스트", price: 6800, category: "food", optionsSupported: false, icon: Cookie, art: "art-food", note: "가볍게 즐기는 오늘의 토스트" },
];
const CATEGORY_INFO: { id: Category; label: string; icon: typeof Coffee }[] = [
  { id: "coffee", label: "커피 · 음료", icon: Coffee },
  { id: "cake", label: "케이크", icon: CakeSlice },
  { id: "dessert", label: "디저트", icon: Cookie },
  { id: "food", label: "간단한 식사", icon: Croissant },
];
const PAYMENT_METHODS = [
  { id: "card", name: "카드", description: "신용 · 체크카드", icon: CreditCard },
  { id: "easy", name: "간편 결제", description: "휴대폰으로 결제", icon: Smartphone },
  { id: "coupon", name: "모바일 쿠폰", description: "쿠폰 바코드 사용", icon: Ticket },
  { id: "gift", name: "상품권", description: "금액권 · 선물 카드", icon: Gift },
] as const;
const categoryNames: Record<Category, string> = { coffee: "커피 · 음료", cake: "케이크", dessert: "디저트", food: "간단한 식사" };
const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const productDefaultOptions = (product: Product): OrderOptions => ({
  temperature: product.temperature === "iced-only" ? "iced" : "hot",
  size: "regular",
  cup: "store",
});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const STAGE_GUIDE: Record<Stage, { title: string; text: string }> = {
  start: { title: "천천히 골라 보세요", text: "매장에서 드실지, 포장하실지 선택하면 메뉴가 열려요." },
  menu: { title: "메뉴를 골라 보세요", text: "분류를 고른 다음 원하는 메뉴의 더하기 버튼을 눌러요." },
  options: { title: "원하는 방식으로 선택해요", text: "옵션을 고르고 아래의 메뉴 담기 버튼을 누르면 돼요." },
  cart: { title: "주문을 확인해요", text: "수량을 바꾸거나 메뉴를 뺄 수 있어요. 확인이 끝나면 결제로 가요." },
  payment: { title: "결제 방법을 골라요", text: "원하는 방법을 선택한 뒤 결제하기를 누르면 돼요." },
  processing: { title: "결제를 확인하고 있어요", text: "잠시만 기다려 주세요. 화면이 자동으로 바뀝니다." },
  complete: { title: "주문이 끝났어요", text: "영수증을 받을지 고르고 처음 화면으로 돌아갈 수 있어요." },
};

function validatePreferences(input: unknown): Preferences {
  if (!isRecord(input)) return { ...DEFAULT_PREFERENCES };
  const textSize = input.textSize === "large" || input.textSize === "extraLarge" ? input.textSize : "standard";
  const buttonSize = input.buttonSize === "large" ? "large" : "standard";
  const contrast = input.contrast === "high" ? "high" : "standard";
  const delay = input.guideDelaySeconds === 10 || input.guideDelaySeconds === 20 ? input.guideDelaySeconds : 15;
  return {
    textSize, buttonSize, contrast,
    easyLanguage: input.easyLanguage === true,
    simplifiedLayout: input.simplifiedLayout === true,
    bottomControls: input.bottomControls === true,
    smartGuide: input.smartGuide === true,
    voiceGuidance: input.voiceGuidance === true,
    guideDelaySeconds: delay,
  };
}

function extractPreferences(body: unknown): Preferences | null {
  if (!isRecord(body)) return null;
  let candidate: unknown = body.preferences;
  if (!isRecord(candidate) && isRecord(body.profile)) candidate = body.profile.preferences;
  if (!isRecord(candidate) && isRecord(body.data)) candidate = body.data.preferences;
  return isRecord(candidate) ? validatePreferences(candidate) : null;
}

function getToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const addressLike = /^[\w.-]+\.[a-z]{2,}(?:\/|[?#])/i.test(trimmed);
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : addressLike ? `https://${trimmed}` : trimmed;
    const url = new URL(candidate, "https://kiosk.invalid");
    const token = url.searchParams.get("token");
    if (token) return token.trim();
    if (/^https?:\/\//i.test(candidate) || addressLike || trimmed.startsWith("/") || trimmed.startsWith("?")) return "";
    return trimmed;
  } catch {
    return trimmed;
  }
}

export default function Current() {
  const [stage, setStage] = useState<Stage>("start");
  const [orderType, setOrderType] = useState<"매장" | "포장">("매장");
  const [category, setCategory] = useState<Category>("coffee");
  const [selectedProduct, setSelectedProduct] = useState<Product>(PRODUCTS[0]);
  const [itemOptions, setItemOptions] = useState<OrderOptions>(productDefaultOptions(PRODUCTS[0]));
  const [itemQuantity, setItemQuantity] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<string>("card");
  const [receiptChoice, setReceiptChoice] = useState<"yes" | "no" | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({ ...DEFAULT_PREFERENCES });
  const [activeProfile, setActiveProfile] = useState<"none" | "central" | "demo">("none");
  const [qrOpen, setQrOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const [guideVisible, setGuideVisible] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [interactionCount, setInteractionCount] = useState(0);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const activityRef = useRef({ count: 0, lastAt: Date.now() });
  const guideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakRef = useRef<(text: string) => void>(() => undefined);

  const say = useCallback((text: string) => {
    if (!preferences.voiceGuidance || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ko-KR";
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech guidance is optional; ordering stays available when the browser does not support it.
    }
  }, [preferences.voiceGuidance]);
  speakRef.current = say;

  const linesCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + (line.product.price + (line.options.size === "large" && line.product.optionsSupported ? 700 : 0)) * line.quantity, 0);
  const total = subtotal;
  useEffect(() => {
    if (!preferences.smartGuide || qrOpen) {
      if (guideTimer.current) clearTimeout(guideTimer.current);
      setGuideVisible(false);
      return;
    }
    setGuideVisible(false);
    const showGuide = () => {
      setGuideVisible(true);
      speakRef.current(STAGE_GUIDE[stage].text);
    };
    const schedule = () => {
      if (guideTimer.current) clearTimeout(guideTimer.current);
      guideTimer.current = setTimeout(showGuide, preferences.guideDelaySeconds * 1000);
    };
    const recordInteraction = () => {
      activityRef.current = { count: activityRef.current.count + 1, lastAt: Date.now() };
      setInteractionCount(activityRef.current.count);
      setGuideVisible(false);
      schedule();
    };
    schedule();
    document.addEventListener("pointerdown", recordInteraction, { passive: true });
    document.addEventListener("keydown", recordInteraction);
    document.addEventListener("touchstart", recordInteraction, { passive: true });
    return () => {
      if (guideTimer.current) clearTimeout(guideTimer.current);
      document.removeEventListener("pointerdown", recordInteraction);
      document.removeEventListener("keydown", recordInteraction);
      document.removeEventListener("touchstart", recordInteraction);
    };
  }, [stage, preferences.smartGuide, preferences.guideDelaySeconds, qrOpen]);

  useEffect(() => {
    if (stage !== "processing") return;
    const timer = setTimeout(() => setStage("complete"), 2200);
    return () => clearTimeout(timer);
  }, [stage]);

  const summaryParts = useMemo(() => {
    const parts: string[] = [];
    if (preferences.textSize !== "standard") parts.push(preferences.textSize === "large" ? "큰 글씨" : "아주 큰 글씨");
    if (preferences.buttonSize === "large") parts.push("큰 버튼");
    if (preferences.contrast === "high") parts.push("높은 대비");
    if (preferences.easyLanguage) parts.push("쉬운 말");
    if (preferences.simplifiedLayout) parts.push("간단한 화면");
    if (preferences.bottomControls) parts.push("아래쪽 조작");
    if (preferences.smartGuide) parts.push(`도움말 ${preferences.guideDelaySeconds}초`);
    if (preferences.voiceGuidance) parts.push("음성 안내");
    return parts;
  }, [preferences]);

  const kioskClass = [
    "kiosk",
    preferences.textSize === "large" ? "text-large" : "",
    preferences.textSize === "extraLarge" ? "text-extra" : "",
    preferences.buttonSize === "large" ? "controls-large" : "",
    preferences.contrast === "high" ? "high-contrast" : "",
    preferences.easyLanguage ? "easy-language" : "",
    preferences.simplifiedLayout ? "simplified" : "",
    preferences.bottomControls ? "bottom-controls" : "",
  ].filter(Boolean).join(" ");

  const openOptions = (product: Product) => {
    setSelectedProduct(product);
    setItemOptions(productDefaultOptions(product));
    setItemQuantity(1);
    setStage("options");
    say(`${product.koreanName} 메뉴를 선택했어요.`);
  };
  const makeLineKey = (product: Product, options: OrderOptions) => `${product.id}-${options.temperature}-${options.size}-${options.cup}`;
  const addToCart = () => {
    const key = makeLineKey(selectedProduct, itemOptions);
    setCart((current) => {
      const found = current.find((line) => line.key === key);
      if (found) return current.map((line) => line.key === key ? { ...line, quantity: line.quantity + itemQuantity } : line);
      return [...current, { key, product: selectedProduct, options: { ...itemOptions }, quantity: itemQuantity }];
    });
    setStage("menu");
    say(`${selectedProduct.koreanName} ${itemQuantity}개를 담았어요.`);
  };
  const changeQuantity = (key: string, delta: number) => {
    setCart((current) => current.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  };
  const removeLine = (key: string) => setCart((current) => current.filter((line) => line.key !== key));
  const startPayment = () => {
    setOrderNumber(`K-${Date.now().toString().slice(-6)}`);
    setStage("processing");
    say("결제를 확인할게요. 잠시만 기다려 주세요.");
  };
  const clearProfile = () => {
    setPreferences({ ...DEFAULT_PREFERENCES });
    setActiveProfile("none");
  };
  const applyDemoProfile = () => {
    setPreferences({ ...DEMO_PREFERENCES });
    setActiveProfile("demo");
    setQrError("");
    setQrOpen(false);
    say("큰 글씨와 쉬운 화면 설정을 적용했어요.");
  };
  const submitToken = async () => {
    const token = getToken(tokenInput);
    if (!token) {
      setQrError("주소에서 토큰을 찾지 못했어요. 토큰을 붙여 넣거나 데모 설정을 적용해 보세요.");
      return;
    }
    setQrLoading(true);
    setQrError("");
    try {
      const response = await fetch("/api/qr-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "접근성 설정을 불러오지 못했어요. 다시 시도하거나 데모 설정을 사용해 주세요.";
        throw new Error(message);
      }
      const resolved = extractPreferences(body);
      if (!resolved) throw new Error("응답에서 접근성 설정을 찾지 못했어요. 데모 설정을 대신 적용할 수 있어요.");
      setPreferences(resolved);
      setActiveProfile("central");
      setQrOpen(false);
      setTokenInput("");
      say("접근성 설정을 불러왔어요.");
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "설정을 불러오지 못했어요. 네트워크를 확인해 주세요.");
    } finally {
      setQrLoading(false);
    }
  };
  const chooseOrderType = (type: "매장" | "포장") => {
    setCart([]);
    setSelectedPayment("card");
    setReceiptChoice(null);
    setOrderType(type);
    setStage("menu");
    say(`${type} 주문을 선택했어요.`);
  };
  const returnToStart = () => {
    setCart([]);
    setReceiptChoice(null);
    setSelectedPayment("card");
    setOrderNumber("");
    setPreferences({ ...DEFAULT_PREFERENCES });
    setActiveProfile("none");
    setStage("start");
    say("새 주문을 시작할 수 있어요.");
  };
  const lineDescription = (line: CartLine) => {
    if (!line.product.optionsSupported) return categoryNames[line.product.category];
    const pieces = [line.options.temperature === "hot" ? "따뜻하게" : "차갑게", line.options.size === "large" ? "큰 사이즈" : "보통 사이즈", line.options.cup === "tumbler" ? "개인 텀블러" : "매장 컵"];
    return pieces.join(" · ");
  };

  const openQr = () => { setQrError(""); setQrOpen(true); };
  const closeQr = () => { if (!qrLoading) setQrOpen(false); };
  const stageStep = stage === "menu" || stage === "options" ? 1 : stage === "cart" ? 2 : stage === "payment" || stage === "processing" ? 3 : stage === "complete" ? 4 : 0;
  const currentProducts = PRODUCTS.filter((product) => product.category === category);
  const visibleProducts = preferences.simplifiedLayout && !showAllProducts ? currentProducts.slice(0, 2) : currentProducts;
  const showQrButton = stage === "start" || stage === "cart";

  return (
    <div className={kioskClass} data-interactions={interactionCount}>
      <div className="shell">
        <header className="topbar">
          <div className="brand-lockup" aria-label="카페 주문 키오스크">
            <div className="brand-mark" aria-hidden="true"><Coffee size={22} /></div>
            <div><div className="brand-name">카페 주문</div><div className="brand-sub">self-service demo</div></div>
          </div>
          <div className="top-actions">
            {preferences.voiceGuidance && <span className="voice-status" aria-live="polite"><Volume2 size={16} /> 음성 안내 켜짐</span>}
            {showQrButton && <button type="button" className="quiet-button" onClick={openQr} aria-label="QR 접근성 설정 불러오기"><QrCode size={18} /><span>설정 불러오기</span></button>}
            <button type="button" className="quiet-button help-button" onClick={() => setHelpOpen(true)}><HandHelping size={18} /><span>직원 도움 요청</span></button>
            <button type="button" className="icon-button" onClick={() => {
              setPreferences((current) => ({ ...current, voiceGuidance: !current.voiceGuidance }));
              if (!preferences.voiceGuidance) say("음성 안내를 켰어요.");
            }} aria-label={preferences.voiceGuidance ? "음성 안내 끄기" : "음성 안내 켜기"}>
              {preferences.voiceGuidance ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
          </div>
        </header>
        <section className="profile-strip" aria-label="현재 접근성 설정">
          <div>
            <div className="profile-label"><Accessibility size={16} /> {activeProfile === "central" ? "공유 접근성 설정 적용 중" : activeProfile === "demo" ? "데모 접근성 설정 적용 중" : "기본 모드"}</div>
            <div className="profile-summary">{summaryParts.length ? summaryParts.join(" · ") : "별도 접근성 프로필을 적용하지 않았어요."}{activeProfile === "demo" ? " · 언제든 바꿀 수 있어요" : ""}</div>
          </div>
          {activeProfile !== "none" && <button type="button" className="clear-profile" onClick={clearProfile}>설정 지우기</button>}
        </section>

        <main className="main-content">
          {stage === "start" && (
            <div className="start-screen">
              <section className="hero-panel">
                <div className="hero-copy">
                  <div className="eyebrow">잠깐의 여유를 준비할게요</div>
                  <h1>오늘의 한 잔,<br />편한 방식으로.</h1>
                  <p className="lede">화면과 안내는 나에게 편한 모습으로 바꿀 수 있어요. 먼저 이용 방법을 골라 주세요.</p>
                  <div className="hero-actions">
                    <button type="button" className={`primary-button ${guideVisible ? "guide-emphasis" : ""}`} id="start-store" onClick={() => chooseOrderType("매장")}><Store size={20} /> 매장에서 먹기 <ArrowRight size={18} /></button>
                    <button type="button" className="secondary-button" onClick={() => chooseOrderType("포장")}><PackageCheck size={20} /> 포장하기</button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true"><span /></div>
              </section>
              <div className="option-grid">
                <button type="button" className="choice-card" onClick={openQr}>
                  <div className="choice-icon"><QrCode size={25} /></div>
                  <div><h3>내 설정 가져오기</h3><p>공유 QR 토큰으로 편한 화면을 불러와요.</p></div><ChevronRight className="choice-arrow" size={21} />
                </button>
                <button type="button" className="choice-card" onClick={applyDemoProfile}>
                  <div className="choice-icon"><Accessibility size={25} /></div>
                  <div><h3>큰 글씨로 시작하기</h3><p>큰 버튼과 쉬운 안내를 바로 적용해요.</p></div><ChevronRight className="choice-arrow" size={21} />
                </button>
              </div>
            </div>
          )}

          {stage === "menu" && (
            <>
              <div className="section-heading">
                <div><div className="eyebrow">ORDER / 01</div><h2>무엇을 드릴까요?</h2><p>{preferences.easyLanguage ? "먹고 싶은 메뉴를 골라 주세요." : "메뉴를 선택해 주세요. 옵션은 다음 화면에서 바꿀 수 있어요."}</p></div>
                <div className="steps" aria-label="주문 단계"><span className="store-chip"><Store size={14} /> {orderType} 주문</span><span className="step-dot active" /><span className="step-dot" /><span className="step-dot" /></div>
              </div>
              <div className="menu-layout">
                <nav className="category-nav" aria-label="메뉴 분류">
                  {CATEGORY_INFO.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" className={`category-button ${category === id ? "active" : ""}`} onClick={() => { setCategory(id); setShowAllProducts(false); say(`${label} 메뉴를 보고 있어요.`); }} aria-pressed={category === id}>
                      <Icon size={19} /> {label}
                    </button>
                  ))}
                </nav>
                <section aria-label={categoryNames[category]}>
                  <div className="product-grid">
                    {visibleProducts.map((product, index) => {
                      const Icon = product.icon;
                      return (
                        <article className={`product-card ${guideVisible && index === 0 ? "guide-emphasis" : ""}`} id={guideVisible && index === 0 ? "menu-first-product" : undefined} key={product.id}>
                          <button type="button" onClick={() => openOptions(product)} aria-label={`${product.koreanName}, ${won(product.price)} 옵션 선택`}>
                            <div className={`product-art ${product.art}`} aria-hidden="true"><Icon size={58} /></div>
                            <div className="product-meta">
                              <div className="product-name-row"><div><h3>{product.name}</h3><div className="product-korean">{product.koreanName}</div></div><span className="price">{won(product.price)}</span></div>
                              {!preferences.simplifiedLayout && <div className="product-korean optional-detail">{product.note}</div>}
                              <div className="product-bottom"><span className="product-tag">{product.optionsSupported ? "옵션 선택 가능" : "바로 담기"}</span><span className="add-round" aria-hidden="true"><Plus size={20} /></span></div>
                            </div>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  {preferences.simplifiedLayout && currentProducts.length > 2 && (
                    <button type="button" className="show-more-button" onClick={() => setShowAllProducts((current) => !current)}>
                      {showAllProducts ? "메뉴 덜 보기" : `메뉴 ${currentProducts.length - 2}개 더 보기`} <ChevronRight size={17} className={showAllProducts ? "rotate-chevron" : ""} />
                    </button>
                  )}
                </section>
              </div>
              {cart.length > 0 && (
                <div className="cart-bar">
                  <div><div><ShoppingBag size={17} style={{ verticalAlign: "middle", marginRight: 7 }} />{linesCount}개 담았어요</div><div className="secondary-note">현재 주문 금액 {won(total)}</div></div>
                  <button type="button" className="primary-button" onClick={() => setStage("cart")}>주문 확인 <ArrowRight size={18} /></button>
                </div>
              )}
              <div className="bottom-actions"><button type="button" className="back-button" onClick={() => setStage("start")}><ArrowLeft size={17} /> 처음으로</button></div>
            </>
          )}

          {stage === "options" && (
            <>
              <div className="page-heading">
                <div><button type="button" className="back-button" onClick={() => setStage("menu")}><ArrowLeft size={17} /> 메뉴로 돌아가기</button><div className="eyebrow">MENU OPTIONS</div><h2>{selectedProduct.koreanName}</h2><p className="lede">{selectedProduct.note}</p></div>
                <span className="steps"><span className="step-dot active" /><span className="step-dot" /><span className="step-dot" /></span>
              </div>
              <div className="item-detail">
                <div className={`item-large-art ${selectedProduct.art}`} aria-hidden="true">{(() => { const Icon = selectedProduct.icon; return <Icon />; })()}</div>
                <div className="item-options">
                  {selectedProduct.optionsSupported && (
                    <>
                      {selectedProduct.temperature && <div className="option-group">
                        <div className="option-group-title"><span>온도</span><span className="required">하나 선택</span></div>
                        <div className="choice-pills">
                          {selectedProduct.temperature === "hot-iced" && <button type="button" className={`pill-option ${itemOptions.temperature === "hot" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, temperature: "hot" }))}>따뜻하게</button>}
                          <button type="button" className={`pill-option ${itemOptions.temperature === "iced" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, temperature: "iced" }))}>차갑게</button>
                        </div>
                      </div>}
                      <div className="option-group">
                        <div className="option-group-title"><span>크기</span><span className="required">큰 사이즈 +700원</span></div>
                        <div className="choice-pills">
                          <button type="button" className={`pill-option ${itemOptions.size === "regular" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, size: "regular" }))}>보통</button>
                          <button type="button" className={`pill-option ${itemOptions.size === "large" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, size: "large" }))}>크게 <span>+700원</span></button>
                        </div>
                      </div>
                      <div className="option-group">
                        <div className="option-group-title"><span>컵 선택</span><span className="required">하나 선택</span></div>
                        <div className="choice-pills">
                          <button type="button" className={`pill-option ${itemOptions.cup === "store" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, cup: "store" }))}>매장 컵</button>
                          <button type="button" className={`pill-option ${itemOptions.cup === "tumbler" ? "selected" : ""}`} onClick={() => setItemOptions((o) => ({ ...o, cup: "tumbler" }))}>개인 텀블러</button>
                        </div>
                      </div>
                    </>
                  )}
                  {!selectedProduct.optionsSupported && <div className="order-summary"><div className="summary-row"><span>메뉴</span><strong>{selectedProduct.koreanName}</strong></div><div className="summary-row"><span>분류</span><span>{categoryNames[selectedProduct.category]}</span></div></div>}
                  <div className="item-footer sticky-action">
                    <div className="quantity-stepper" aria-label="수량 선택">
                      <button type="button" className="stepper-button" aria-label="수량 줄이기" onClick={() => setItemQuantity((q) => Math.max(1, q - 1))}><Minus size={18} /></button>
                      <strong aria-live="polite">{itemQuantity}</strong>
                      <button type="button" className="stepper-button" aria-label="수량 늘리기" onClick={() => setItemQuantity((q) => q + 1)}><Plus size={18} /></button>
                    </div>
                    <button type="button" className={`primary-button accent ${guideVisible ? "guide-emphasis" : ""}`} id="item-add" onClick={addToCart}>메뉴 담기 · {won((selectedProduct.price + (itemOptions.size === "large" && selectedProduct.optionsSupported ? 700 : 0)) * itemQuantity)} <Plus size={18} /></button>
                  </div>
                </div>
              </div>
            </>
          )}

          {stage === "cart" && (
            <>
              <div className="page-heading">
                <div><button type="button" className="back-button" onClick={() => setStage("menu")}><ArrowLeft size={17} /> 메뉴 더 고르기</button><div className="eyebrow">ORDER / 02</div><h2>주문을 확인해 주세요</h2><p className="lede">{preferences.easyLanguage ? "수량을 바꾸거나 빼도 괜찮아요." : "메뉴와 수량을 확인한 뒤 결제로 이동해 주세요."}</p></div>
                <button type="button" className="quiet-button" onClick={openQr}><QrCode size={18} /> 설정 불러오기</button>
              </div>
              {cart.length === 0 ? (
                <div className="empty-state"><ShoppingBag size={31} /><h3>아직 담긴 메뉴가 없어요</h3><p>메뉴에서 먹고 싶은 것을 골라 주세요.</p><button type="button" className="primary-button" onClick={() => setStage("menu")}>메뉴 고르기 <ArrowRight size={17} /></button></div>
              ) : (
                <>
                  <div className="cart-list">
                    {cart.map((line) => (
                      <article className="cart-item" key={line.key}>
                        <div><h3>{line.product.koreanName}</h3><p>{lineDescription(line)}</p></div>
                        <div className="cart-price">{won((line.product.price + (line.options.size === "large" && line.product.optionsSupported ? 700 : 0)) * line.quantity)}</div>
                        <div className="cart-quantity">
                          <button type="button" aria-label={`${line.product.koreanName} 수량 줄이기`} onClick={() => changeQuantity(line.key, -1)}><Minus size={15} /></button><strong>{line.quantity}</strong><button type="button" aria-label={`${line.product.koreanName} 수량 늘리기`} onClick={() => changeQuantity(line.key, 1)}><Plus size={15} /></button>
                        </div>
                        <button type="button" className="cart-quantity remove-button" aria-label={`${line.product.koreanName} 삭제`} onClick={() => removeLine(line.key)}><Trash2 size={17} /></button>
                      </article>
                    ))}
                  </div>
                  <div className="order-summary">
                    <div className="summary-row"><span>주문 수량</span><span>{linesCount}개</span></div>
                    <div className="summary-row total"><span>총 결제 금액</span><span>{won(total)}</span></div>
                  </div>
                  <div className="bottom-actions">
                    <button type="button" className="secondary-button" onClick={() => setStage("menu")}>메뉴 더 고르기</button>
                    <button type="button" className={`primary-button accent ${guideVisible ? "guide-emphasis" : ""}`} id="cart-pay" onClick={() => { setStage("payment"); say("결제 방법을 골라 주세요."); }}>결제하기 · {won(total)} <ArrowRight size={18} /></button>
                  </div>
                </>
              )}
            </>
          )}

          {stage === "payment" && (
            <>
              <div className="page-heading">
                <div><button type="button" className="back-button" onClick={() => setStage("cart")}><ArrowLeft size={17} /> 주문 확인으로</button><div className="eyebrow">ORDER / 03</div><h2>어떻게 결제할까요?</h2><p className="lede">결제는 이 화면에서만 시뮬레이션됩니다. 실제 결제는 진행되지 않아요.</p></div>
                <div className="steps"><span className="step-dot active" /><span className="step-dot active" /><span className="step-dot active" /></div>
              </div>
              <div className="payment-grid" role="group" aria-label="결제 방법">
                {PAYMENT_METHODS.map(({ id, name, description, icon: Icon }) => (
                  <button key={id} type="button" className={`payment-option ${selectedPayment === id ? "selected" : ""}`} onClick={() => { setSelectedPayment(id); say(`${name} 결제를 선택했어요.`); }} aria-pressed={selectedPayment === id}>
                    <div className="payment-option-icon"><Icon size={22} /></div><div><h3>{name}</h3><p>{description}</p></div>{selectedPayment === id && <Check size={19} />}
                  </button>
                ))}
              </div>
              <div className="order-summary" style={{ maxWidth: 760, marginTop: 22 }}>
                <div className="summary-row"><span>선택한 결제 방법</span><strong>{PAYMENT_METHODS.find((method) => method.id === selectedPayment)?.name}</strong></div>
                <div className="summary-row total"><span>결제 예정 금액</span><span>{won(total)}</span></div>
              </div>
              <div className="bottom-actions">
                <button type="button" className="secondary-button" onClick={() => setStage("cart")}>주문 다시 보기</button>
                <button type="button" className={`primary-button accent ${guideVisible ? "guide-emphasis" : ""}`} id="payment-pay" onClick={startPayment}>결제하기 · {won(total)} <ArrowRight size={18} /></button>
              </div>
            </>
          )}

          {stage === "processing" && (
            <section className="processing-panel" id="processing-wait" aria-live="polite">
              <div className="processing-mark"><Clock3 size={42} /></div>
              <div className="eyebrow">PAYMENT DEMO</div>
              <h2>결제를 확인하고 있어요</h2>
              <p>{selectedPayment === "card" ? "카드를 꽂거나 태그하는 결제 순서를 보여드려요." : selectedPayment === "easy" ? "휴대폰 결제를 확인하는 순서를 보여드려요." : selectedPayment === "coupon" ? "모바일 쿠폰을 확인하는 순서를 보여드려요." : "상품권을 확인하는 순서를 보여드려요."}<br />실제 결제는 진행되지 않아요. 잠시만 기다려 주세요.</p>
              <div className="loading-state" style={{ justifyContent: "center" }}><span className="loading-dot" /> 실제 결제 없이 데모로 진행 중</div>
            </section>
          )}

          {stage === "complete" && (
            <section className="complete-panel">
              <div className="processing-mark complete-mark"><Check size={42} /></div>
              <div className="eyebrow">ORDER COMPLETE</div>
              <h2>주문이 완료됐어요</h2>
              <div className="order-number">주문 번호　{orderNumber}</div>
              <p>{orderType} 주문 · {linesCount}개 메뉴 · {won(total)}<br />주문을 확인하고 준비를 시작할게요.</p>
              <div className="receipt-box">
                {receiptChoice === null ? <>
                  <h3>영수증을 받을까요?</h3>
                  <div className="receipt-actions">
                    <button type="button" className="secondary-button" onClick={() => { setReceiptChoice("yes"); say("영수증을 선택했어요."); }}>네, 받을게요</button>
                    <button type="button" className="secondary-button" onClick={() => { setReceiptChoice("no"); say("영수증 없이 진행할게요."); }}>아니요</button>
                  </div>
                </> : <div className="receipt-result" aria-live="polite">{receiptChoice === "yes" ? "영수증을 준비했어요. (데모)" : "영수증 없이 마무리했어요."}</div>}
              </div>
              <button type="button" className={`primary-button accent ${guideVisible ? "guide-emphasis" : ""}`} id="complete-reset" style={{ marginTop: 20 }} onClick={returnToStart}><RotateCcw size={18} /> 처음으로 돌아가기</button>
            </section>
          )}
        </main>

        <footer className="optional-detail" style={{ paddingTop: 22, color: "var(--muted)", fontSize: ".72em", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>편안한 주문 경험을 위한 접근성 키오스크 데모</span>
          {preferences.smartGuide && <span><Sparkles size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />{preferences.guideDelaySeconds}초 후 도움말 · 활동 {interactionCount}회</span>}
        </footer>
      </div>

      {guideVisible && preferences.smartGuide && !qrOpen && (
        <aside className="guide-toast" role="status" aria-live="polite">
          <div><Info size={20} /></div><p><strong>{STAGE_GUIDE[stage].title}</strong>{STAGE_GUIDE[stage].text}</p>
        </aside>
      )}

      {qrOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeQr(); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="qr-title">
            <div className="modal-header">
              <div><div className="eyebrow">SHARED ACCESSIBILITY</div><h2 id="qr-title">내 설정 불러오기</h2><p>공유받은 주소나 토큰으로 편한 주문 설정을 적용해요.</p></div>
              <button type="button" className="icon-button" onClick={closeQr} aria-label="설정 불러오기 닫기"><X size={19} /></button>
            </div>
            <div className="scan-placeholder">
              <ScanLine size={32} />
              <div><strong>QR 카메라 스캔은 데모에서 사용할 수 없어요</strong><p>아래 칸에 공유 주소 또는 토큰을 직접 붙여 넣어 주세요.</p></div>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void submitToken(); }}>
              <label className="field-label" htmlFor="profile-token">공유 주소 또는 토큰</label>
              <input id="profile-token" className="text-field" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="주소 또는 토큰 붙여 넣기" autoComplete="off" />
              {qrLoading && <div className="loading-state" role="status"><span className="loading-dot" /> 설정을 불러오고 있어요. 잠시만 기다려 주세요.</div>}
              {qrError && <div className="error-message" role="alert">{qrError}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={applyDemoProfile} disabled={qrLoading}><Accessibility size={18} /> 데모 설정 적용</button>
                <button type="submit" className="primary-button" disabled={qrLoading}>{qrLoading ? "불러오는 중" : "설정 불러오기"} <ArrowRight size={17} /></button>
              </div>
            </form>
            <div className="demo-profile"><Sparkles size={17} /><div><strong>빠른 데모 설정</strong>큰 글씨 · 높은 대비 · 쉬운 말 · 아래쪽 큰 버튼 · 음성 안내 · 10초 도움말</div></div>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-header">
              <div><div className="eyebrow">STAFF HELP</div><h2 id="help-title">직원 도움이 필요하신가요?</h2><p>이 화면은 키오스크 흐름을 보여주는 데모입니다. 실제 직원 호출은 연결되어 있지 않아요.</p></div>
              <button type="button" className="icon-button" onClick={() => setHelpOpen(false)} aria-label="직원 도움 안내 닫기"><X size={19} /></button>
            </div>
            <div className="help-note"><HandHelping size={22} /><span>가까운 직원에게 직접 말씀해 주시면 도와드릴게요.</span></div>
            <button type="button" className="primary-button accent help-close" onClick={() => setHelpOpen(false)}>확인</button>
          </section>
        </div>
      )}
    </div>
  );
}
