import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accessibility, ArrowLeft, ArrowRight, CakeSlice, Check, ChevronRight, Clock3, Coffee,
  Cookie, CreditCard, Croissant, Gift, GlassWater, HandHelping, Minus, PackageCheck, Plus,
  QrCode, RotateCcw, ShoppingBag, Smartphone, Sparkles, Store, Ticket,
  Trash2, Volume2, VolumeX, X,
} from "lucide-react";
import {
  createAccessibilitySdk,
  DEFAULT_ACCESSIBILITY_PROFILE,
  validateAccessibilityProfile,
  type AccessibilityProfile,
  type AccessibilitySdk,
} from "@naebangsik/kiosk-accessibility-sdk";
import { getManualProfileToken, getScannedProfileToken, isValidProfileToken } from "./qrProfile";
import {
  createCafeAccessibilityAdapter,
  resolveCafeGuide,
  type CafeAdapterState,
  type CafeStage,
} from "./accessibility/cafeAdapter";

const QrCameraScanner = lazy(() => import("./components/QrCameraScanner"));

type Stage = CafeStage;
type Category = "coffee" | "cake" | "dessert" | "food";
type Preferences = AccessibilityProfile;
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

const DEFAULT_PREFERENCES: Preferences = { ...DEFAULT_ACCESSIBILITY_PROFILE };
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
function isUnavailableProfileResponse(body: unknown): boolean {
  if (!isRecord(body)) return true;
  const candidates: Record<string, unknown>[] = [body];
  if (isRecord(body.profile)) candidates.push(body.profile);
  if (isRecord(body.data)) candidates.push(body.data);

  const unavailableStatuses = new Set(["disabled", "inactive", "deactivated", "revoked", "expired", "deleted", "unavailable"]);
  return candidates.some((candidate) => {
    const status = typeof candidate.status === "string" ? candidate.status.trim().toLowerCase() : "";
    return candidate.success === false ||
      candidate.ok === false ||
      candidate.active === false ||
      candidate.enabled === false ||
      candidate.isActive === false ||
      candidate.isEnabled === false ||
      candidate.disabled === true ||
      candidate.revoked === true ||
      unavailableStatuses.has(status);
  });
}

function extractPreferences(body: unknown): Preferences | null {
  if (!isRecord(body)) return null;
  let candidate: unknown = body.preferences;
  if (!isRecord(candidate) && isRecord(body.profile)) candidate = body.profile.preferences;
  if (!isRecord(candidate) && isRecord(body.data)) candidate = body.data.preferences;
  return isRecord(candidate) ? validateAccessibilityProfile(candidate) : null;
}

export default function App() {
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
  const [activeProfile, setActiveProfile] = useState<"none" | "central" | "demo" | "manual">("none");
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMode, setQrMode] = useState<"camera" | "manual">("camera");
  const [qrCameraError, setQrCameraError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const qrRequestInFlightRef = useRef(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [interactionCount, setInteractionCount] = useState(0);
  const [menuFocusIndex, setMenuFocusIndex] = useState(0);
  const [menuNavigationActive, setMenuNavigationActive] = useState(false);
  const kioskRootRef = useRef<HTMLDivElement>(null);
  const accessibilitySdkRef = useRef<AccessibilitySdk | null>(null);
  const cafeStateRef = useRef<CafeAdapterState>({
    stage: "start",
    cartItemCount: 0,
    easyLanguage: false,
    simplifiedLayout: false,
    menuNavigationActive: false,
    menuIndex: 0,
    menuCount: 0,
    selectedMenuName: "",
    optionsSupported: false,
    temperature: "hot",
    size: "regular",
    cup: "store",
    itemQuantity: 1,
    categoryId: "coffee",
  });
  const productGridRef = useRef<HTMLDivElement>(null);
  const menuBrowseRef = useRef<HTMLDivElement>(null);
  const programmaticMenuScrollRef = useRef(false);
  const menuScrollGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string) => {
    accessibilitySdkRef.current?.speak(text);
  }, []);

  const linesCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + (line.product.price + (line.options.size === "large" && line.product.optionsSupported ? 700 : 0)) * line.quantity, 0);
  const total = subtotal;
  const currentProducts = PRODUCTS.filter((product) => product.category === category);
  const isLastMenu = menuFocusIndex >= currentProducts.length - 1;

  cafeStateRef.current = {
    stage,
    cartItemCount: linesCount,
    easyLanguage: preferences.easyLanguage,
    simplifiedLayout: preferences.simplifiedLayout,
    menuNavigationActive,
    menuIndex: menuFocusIndex,
    menuCount: currentProducts.length,
    selectedMenuName: selectedProduct.koreanName,
    optionsSupported: selectedProduct.optionsSupported,
    temperature: itemOptions.temperature === "hot" ? "hot" : "iced",
    size: itemOptions.size,
    cup: itemOptions.cup,
    itemQuantity,
    categoryId: category,
  };

  const cafeAdapter = useMemo(
    () => createCafeAccessibilityAdapter(() => kioskRootRef.current, () => cafeStateRef.current),
    [],
  );
  const guideCopy = useMemo(() => resolveCafeGuide({
    stage,
    cartItemCount: linesCount,
    easyLanguage: preferences.easyLanguage,
    simplifiedLayout: preferences.simplifiedLayout,
    menuNavigationActive,
    menuIndex: menuFocusIndex,
    menuCount: currentProducts.length,
    selectedMenuName: selectedProduct.koreanName,
    optionsSupported: selectedProduct.optionsSupported,
    temperature: itemOptions.temperature === "hot" ? "hot" : "iced",
    size: itemOptions.size,
    cup: itemOptions.cup,
    itemQuantity,
  }), [
    stage,
    linesCount,
    preferences.easyLanguage,
    preferences.simplifiedLayout,
    menuNavigationActive,
    menuFocusIndex,
    currentProducts.length,
    selectedProduct.koreanName,
    selectedProduct.optionsSupported,
    itemOptions.temperature,
    itemOptions.size,
    itemOptions.cup,
    itemQuantity,
  ]);

  useEffect(() => {
    const root = kioskRootRef.current;
    if (!root) return;
    const sdk = createAccessibilitySdk({
      root,
      adapter: cafeAdapter,
      onInteractionCount: setInteractionCount,
      onDiagnostics: (issues) => {
        if (import.meta.env.DEV && issues.length > 0) {
          console.info("[kiosk accessibility diagnostics]", issues);
        }
      },
    });
    accessibilitySdkRef.current = sdk;
    return () => {
      sdk.destroy();
      if (accessibilitySdkRef.current === sdk) accessibilitySdkRef.current = null;
    };
  }, [cafeAdapter]);

  useEffect(() => {
    accessibilitySdkRef.current?.applyProfile(preferences);
  }, [preferences]);

  useEffect(() => {
    accessibilitySdkRef.current?.setGuideState({
      enabled: preferences.smartGuide,
      paused: qrOpen || stage === "processing",
      delaySeconds: preferences.guideDelaySeconds,
      message: guideCopy,
    });
  }, [guideCopy, preferences.smartGuide, preferences.guideDelaySeconds, qrOpen, stage]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const frame = requestAnimationFrame(() => accessibilitySdkRef.current?.inspectLayout());
    return () => cancelAnimationFrame(frame);
  }, [stage, preferences]);

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

  const goToNextMenu = () => {
    if (isLastMenu) return;
    const nextIndex = menuFocusIndex + 1;
    setMenuNavigationActive(true);
    setMenuFocusIndex(nextIndex);
    programmaticMenuScrollRef.current = true;
    if (menuScrollGuardRef.current) clearTimeout(menuScrollGuardRef.current);
    menuScrollGuardRef.current = setTimeout(() => {
      programmaticMenuScrollRef.current = false;
      menuScrollGuardRef.current = null;
    }, 900);
    requestAnimationFrame(() => {
      const target = productGridRef.current?.querySelector<HTMLElement>(`[data-menu-index="${nextIndex}"]`);
      if (!target) return;
      const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      target.scrollIntoView({ behavior, block: "start" });
      target.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (stage !== "menu") return;
    let animationFrame = 0;
    const updateMenuPosition = () => {
      if (programmaticMenuScrollRef.current) return;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (programmaticMenuScrollRef.current) return;
        const cards = Array.from(productGridRef.current?.querySelectorAll<HTMLElement>(".product-card") ?? []);
        if (!cards.length) return;
        const browseBottom = menuBrowseRef.current?.getBoundingClientRect().bottom ?? 0;
        const visibleIndex = cards.findIndex((card) => card.getBoundingClientRect().bottom > Math.max(0, browseBottom) + 8);
        const pageIsScrollable = document.documentElement.scrollHeight > window.innerHeight + 2;
        const atPageBottom = pageIsScrollable && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        const nextIndex = atPageBottom || visibleIndex === -1 ? cards.length - 1 : Number(cards[visibleIndex].dataset.menuIndex);
        if (!Number.isNaN(nextIndex)) {
          setMenuFocusIndex((current) => current === nextIndex ? current : nextIndex);
        }
      });
    };
    window.addEventListener("scroll", updateMenuPosition, { passive: true });
    updateMenuPosition();
    return () => {
      window.removeEventListener("scroll", updateMenuPosition);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (menuScrollGuardRef.current) clearTimeout(menuScrollGuardRef.current);
      menuScrollGuardRef.current = null;
      programmaticMenuScrollRef.current = false;
    };
  }, [category, currentProducts.length, stage]);

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
    setProfileDetailsOpen(false);
  };
  const applyDemoProfile = () => {
    setPreferences({ ...DEMO_PREFERENCES });
    setActiveProfile("demo");
    setProfileDetailsOpen(false);
    setQrError("");
    setQrOpen(false);
    setAccessibilityOpen(false);
    say("큰 글씨와 쉬운 화면 설정을 적용했어요.");
  };
  const applyQuickPreference = (preference: "large" | "contrast") => {
    setPreferences((current) => preference === "large"
      ? { ...current, textSize: "large", buttonSize: "large" }
      : { ...current, contrast: "high" });
    setActiveProfile("manual");
    setProfileDetailsOpen(false);
    setAccessibilityOpen(false);
    say(preference === "large" ? "큰 글씨와 큰 버튼을 적용했어요." : "고대비 화면을 적용했어요.");
  };
  const loadProfileToken = async (token: string) => {
    if (!isValidProfileToken(token)) {
      setQrError("사용할 수 없는 QR이에요");
      return;
    }
    if (qrRequestInFlightRef.current) return;

    qrRequestInFlightRef.current = true;
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
        if ([400, 401, 403, 404, 410, 422].includes(response.status)) {
          throw new Error("사용할 수 없는 QR이에요");
        }
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "접근성 설정을 불러오지 못했어요. 다시 시도하거나 데모 설정을 사용해 주세요.";
        throw new Error(message);
      }
      if (isUnavailableProfileResponse(body)) throw new Error("사용할 수 없는 QR이에요");
      const resolved = extractPreferences(body);
      if (!resolved) throw new Error("사용할 수 없는 QR이에요");
      setPreferences(resolved);
      setActiveProfile("central");
      setProfileDetailsOpen(false);
      setQrOpen(false);
      setTokenInput("");
      setQrCameraError("");
      say("접근성 설정을 불러왔어요.");
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "설정을 불러오지 못했어요. 네트워크를 확인해 주세요.");
    } finally {
      qrRequestInFlightRef.current = false;
      setQrLoading(false);
    }
  };
  const submitManualToken = () => {
    const token = getManualProfileToken(tokenInput);
    if (!token) {
      setQrError("사용할 수 없는 QR이에요. 공식 주소 또는 토큰을 확인해 주세요.");
      return;
    }
    void loadProfileToken(token);
  };
  const handleScannedQr = (value: string) => {
    const token = getScannedProfileToken(value);
    setQrError("");
    if (!token) {
      setQrError("사용할 수 없는 QR이에요");
      return;
    }
    void loadProfileToken(token);
  };
  const handleCameraUnavailable = (message: string) => {
    setQrCameraError(message);
    setQrError("");
    setQrMode("manual");
  };
  const chooseOrderType = (type: "매장" | "포장") => {
    setCart([]);
    setSelectedPayment("card");
    setReceiptChoice(null);
    setOrderType(type);
    setMenuFocusIndex(0);
    setMenuNavigationActive(false);
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
    setProfileDetailsOpen(false);
    setMenuNavigationActive(false);
    setStage("start");
    say("새 주문을 시작할 수 있어요.");
  };
  const lineDescription = (line: CartLine) => {
    if (!line.product.optionsSupported) return categoryNames[line.product.category];
    const pieces = [line.options.temperature === "hot" ? "따뜻하게" : "차갑게", line.options.size === "large" ? "큰 사이즈" : "보통 사이즈", line.options.cup === "tumbler" ? "개인 텀블러" : "매장 컵"];
    return pieces.join(" · ");
  };

  const openQr = () => {
    setAccessibilityOpen(false);
    setQrError("");
    setQrCameraError("");
    setQrMode("camera");
    setQrOpen(true);
  };
  const closeQr = () => { if (!qrLoading) setQrOpen(false); };
  const stageStep = stage === "menu" || stage === "options" ? 1 : stage === "cart" ? 2 : stage === "payment" || stage === "processing" ? 3 : stage === "complete" ? 4 : 0;
  const showQrButton = stage === "cart";

  return (
    <div ref={kioskRootRef} className="kiosk" data-interactions={interactionCount}>
      <div className="shell" data-a11y-slot="scroll-content">
        <header className="topbar">
          <div className="brand-lockup" aria-label="데모커피 DEMO COFFEE">
            <div className="brand-mark" aria-hidden="true"><Coffee size={22} /></div>
            <div><div className="brand-name">데모커피</div><div className="brand-sub">DEMO COFFEE</div></div>
          </div>
          <div className="top-actions">
            {preferences.voiceGuidance && <span className="voice-status" aria-live="polite"><Volume2 size={16} /> 음성 안내 켜짐</span>}
            {showQrButton && <button type="button" className="quiet-button" onClick={openQr} aria-label="QR 접근성 설정 불러오기"><QrCode size={18} /><span>설정 불러오기</span></button>}
            {stage !== "start" && <button type="button" className="quiet-button help-button" onClick={() => setHelpOpen(true)}><HandHelping size={18} /><span>직원 도움 요청</span></button>}
            <button type="button" className="icon-button" onClick={() => {
              setPreferences((current) => ({ ...current, voiceGuidance: !current.voiceGuidance }));
              if (!preferences.voiceGuidance) say("음성 안내를 켰어요.");
            }} aria-label={preferences.voiceGuidance ? "음성 안내 끄기" : "음성 안내 켜기"}>
              {preferences.voiceGuidance ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
          </div>
        </header>
        {activeProfile !== "none" && (
          <section className={`profile-strip ${profileDetailsOpen ? "expanded" : ""}`} aria-label="적용된 화면 설정">
            <div className="profile-strip-main">
              <div className="profile-label"><Accessibility size={18} /> {activeProfile === "central" ? "내 QR 설정 적용 중" : activeProfile === "demo" ? "간편 설정 적용 중" : "편한 화면 설정 적용 중"}</div>
              <div id="profile-details" className="profile-details" hidden={!profileDetailsOpen}>
                <ul className="profile-summary">
                  {(summaryParts.length ? summaryParts : ["화면 기본 설정"]).map((part) => <li key={part}>{part}</li>)}
                </ul>
              </div>
            </div>
            <div className="profile-actions">
              <button
                type="button"
                className="profile-details-toggle"
                aria-expanded={profileDetailsOpen}
                aria-controls="profile-details"
                onClick={() => setProfileDetailsOpen((current) => !current)}
              >
                {profileDetailsOpen ? "설정 닫기" : "설정 보기"}
              </button>
              <button type="button" className="clear-profile" onClick={clearProfile}>
                <RotateCcw size={15} aria-hidden="true" /><span className="button-label">설정 초기화</span>
              </button>
            </div>
          </section>
        )}

        <main className="main-content">
          {stage === "start" && (
            <div className="start-screen">
              <section className="hero-panel">
                <figure className="hero-art">
                  <img src="/images/democoffee-welcome-cup.jpg" alt="라떼 아트가 담긴 크림색 커피잔" />
                  <figcaption className="hero-art-caption">
                    <span className="hero-art-caption-icon" aria-hidden="true"><Coffee size={17} /></span>
                    <span><strong>오늘의 한 잔</strong><small>따뜻한 커피 한 잔의 여유</small></span>
                  </figcaption>
                </figure>
                <div className="hero-copy">
                  <div className="eyebrow">COFFEE · DESSERT</div>
                  <h1 data-a11y-text data-a11y-id="cafe.welcome.title">오늘도<br />향긋한 한 잔</h1>
                  <p className="lede">맛있는 커피와 편안한 시간을 선사합니다.</p>
                  <div className="hero-actions">
                    <button type="button" className="primary-button" id="start-store" data-a11y-action-id="start-store" data-a11y-primary="true" onClick={() => chooseOrderType("매장")}><Store size={20} /><span className="button-label">매장 이용</span><ArrowRight size={18} /></button>
                    <button type="button" className="secondary-button" id="start-takeout" data-a11y-action-id="start-takeout" onClick={() => chooseOrderType("포장")}><PackageCheck size={20} /><span className="button-label">포장하기</span></button>
                  </div>
                </div>
              </section>
              <div className="welcome-support" aria-label="추가 도움">
                <button type="button" className="welcome-link" onClick={() => setAccessibilityOpen(true)}>
                  <span className="welcome-link-icon"><Accessibility size={19} /></span>
                  <span className="welcome-link-copy"><strong>편한 화면 설정</strong><small>원하는 화면으로 바꿔 보세요</small></span>
                  <ChevronRight className="welcome-link-arrow" size={19} />
                </button>
                <button type="button" className="welcome-link" onClick={() => setHelpOpen(true)}>
                  <span className="welcome-link-icon"><HandHelping size={19} /></span>
                  <span className="welcome-link-copy"><strong>직원 도움</strong><small>주문이 어려우시면 말씀해 주세요</small></span>
                  <ChevronRight className="welcome-link-arrow" size={19} />
                </button>
              </div>
            </div>
          )}

          {stage === "menu" && (
            <>
              <div className="section-heading">
                <div><div className="eyebrow">ORDER / 01</div><h2 data-a11y-text data-a11y-id="cafe.menu.title">무엇을 드릴까요?</h2><p data-a11y-text data-a11y-id="cafe.menu.instruction">{preferences.easyLanguage ? "먹고 싶은 메뉴를 골라 주세요." : "메뉴를 선택해 주세요. 옵션은 다음 화면에서 바꿀 수 있어요."}</p></div>
                <div className="steps" aria-label="주문 단계"><span className="store-chip"><Store size={14} /> {orderType} 주문</span><span className="step-dot active" /><span className="step-dot" /><span className="step-dot" /></div>
              </div>
              <div className="menu-layout">
                <nav className="category-nav" aria-label="메뉴 분류">
                  {CATEGORY_INFO.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" className={`category-button ${category === id ? "active" : ""}`} onClick={() => {
                      setCategory(id);
                      setMenuFocusIndex(0);
                      setMenuNavigationActive(false);
                      const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
                      requestAnimationFrame(() => document.querySelector(".section-heading")?.scrollIntoView({ behavior, block: "start" }));
                      say(`${label} 메뉴를 보고 있어요.`);
                    }} aria-pressed={category === id}>
                      <Icon size={19} /> {label}
                    </button>
                  ))}
                </nav>
                <section className="menu-products" aria-label={categoryNames[category]}>
                  {preferences.simplifiedLayout && (
                    <div className="menu-browse-tools" ref={menuBrowseRef}>
                      <p className="menu-browse-note" aria-live="polite">
                        <strong>{isLastMenu ? "이 분류의 메뉴를 모두 확인했어요." : "아래에도 메뉴가 있어요."}</strong>
                        <span>메뉴 {Math.min(menuFocusIndex + 1, currentProducts.length)} / {currentProducts.length}</span>
                      </p>
                      <button type="button" id="menu-next-button" data-a11y-action-id="menu-next-button" data-a11y-primary="true" className="menu-next-button" onClick={goToNextMenu} disabled={isLastMenu}>
                        <span>{isLastMenu ? "마지막 메뉴예요" : "다음 메뉴 보기"}</span>
                        {!isLastMenu && <ArrowRight size={18} aria-hidden="true" />}
                      </button>
                    </div>
                  )}
                  <div
                    className="product-grid"
                    ref={productGridRef}
                    data-menu-count={currentProducts.length}
                    data-simplified={preferences.simplifiedLayout}
                  >
                    {currentProducts.map((product, index) => {
                      const Icon = product.icon;
                      return (
                        <article
                          className="product-card"
                          data-a11y-highlight-container
                          data-menu-index={index}
                          key={product.id}
                        >
                          <button type="button" id={`menu-product-${index}`} data-a11y-action-id={`menu-product-${index}`} onClick={() => { setMenuFocusIndex(index); openOptions(product); }} aria-label={`${product.koreanName}, ${won(product.price)} 옵션 선택`}>
                            <div className={`product-art ${product.art}`} aria-hidden="true"><Icon size={58} /></div>
                            <div className="product-meta">
                              <div className="product-name-row"><div><h3>{product.name}</h3><div className="product-korean">{product.koreanName}</div></div><span className="price">{won(product.price)}</span></div>
                              {!preferences.simplifiedLayout && <div className="product-korean optional-detail" data-a11y-detail data-a11y-text data-a11y-id={`cafe.product.${product.id}.note`}>{product.note}</div>}
                              <div className="product-bottom"><span className="product-tag">{product.optionsSupported ? "옵션 선택 가능" : "바로 담기"}</span><span className="add-round" aria-hidden="true"><Plus size={20} /></span></div>
                            </div>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
              {cart.length > 0 && (
                <div className="cart-bar" data-a11y-slot="above-bottom-controls">
                  <div><div><ShoppingBag size={17} style={{ verticalAlign: "middle", marginRight: 7 }} />{linesCount}개 담았어요</div><div className="secondary-note">현재 주문 금액 {won(total)}</div></div>
                  <button type="button" id="menu-order-confirm" data-a11y-action-id="menu-order-confirm" data-a11y-primary="true" className="primary-button" onClick={() => setStage("cart")}>주문 확인 <ArrowRight size={18} /></button>
                </div>
              )}
              <div className="bottom-actions" data-a11y-slot="bottom-controls"><button type="button" className="back-button" onClick={() => setStage("start")}><ArrowLeft size={17} /> 처음으로</button></div>
            </>
          )}

          {stage === "options" && (
            <>
              <div className="page-heading">
                <div><button type="button" className="back-button" onClick={() => setStage("menu")}><ArrowLeft size={17} /> 메뉴로 돌아가기</button><div className="eyebrow">MENU OPTIONS</div><h2 data-a11y-text data-a11y-id="cafe.options.title">{selectedProduct.koreanName}</h2><p className="lede" data-a11y-text data-a11y-id="cafe.options.description">{selectedProduct.note}</p></div>
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
                  <div className="item-footer sticky-action" data-a11y-slot="bottom-controls">
                    <div className="quantity-stepper" aria-label="수량 선택">
                      <button type="button" className="stepper-button" aria-label="수량 줄이기" onClick={() => setItemQuantity((q) => Math.max(1, q - 1))}><Minus size={18} /></button>
                      <strong aria-live="polite">{itemQuantity}</strong>
                      <button type="button" className="stepper-button" aria-label="수량 늘리기" onClick={() => setItemQuantity((q) => q + 1)}><Plus size={18} /></button>
                    </div>
                    <button type="button" className="primary-button accent" id="item-add" data-a11y-action-id="item-add" data-a11y-primary="true" onClick={addToCart}>메뉴 담기 · {won((selectedProduct.price + (itemOptions.size === "large" && selectedProduct.optionsSupported ? 700 : 0)) * itemQuantity)} <Plus size={18} /></button>
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
                <div className="empty-state"><ShoppingBag size={31} /><h3>아직 담긴 메뉴가 없어요</h3><p>메뉴에서 먹고 싶은 것을 골라 주세요.</p><button type="button" id="cart-empty-menu" data-a11y-action-id="cart-empty-menu" data-a11y-primary="true" className="primary-button" onClick={() => setStage("menu")}>메뉴 고르기 <ArrowRight size={17} /></button></div>
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
                  <div className="bottom-actions" data-a11y-slot="bottom-controls">
                    <button type="button" className="secondary-button" onClick={() => setStage("menu")}>메뉴 더 고르기</button>
                    <button type="button" className="primary-button accent" id="cart-pay" data-a11y-action-id="cart-pay" data-a11y-primary="true" onClick={() => { setStage("payment"); say("결제 방법을 골라 주세요."); }}>결제하기 · {won(total)} <ArrowRight size={18} /></button>
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
              <div className="bottom-actions" data-a11y-slot="bottom-controls">
                <button type="button" className="secondary-button" onClick={() => setStage("cart")}>주문 다시 보기</button>
                <button type="button" className="primary-button accent" id="payment-pay" data-a11y-action-id="payment-pay" data-a11y-primary="true" onClick={startPayment}>결제하기 · {won(total)} <ArrowRight size={18} /></button>
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
              <button type="button" className="primary-button accent" id="complete-reset" data-a11y-action-id="complete-reset" data-a11y-primary="true" style={{ marginTop: 20 }} onClick={returnToStart}><RotateCcw size={18} /> 처음으로 돌아가기</button>
            </section>
          )}
        </main>

        {stage !== "start" && preferences.smartGuide && (
          <footer className="optional-detail smart-guide-status">
            <Sparkles size={13} /> {preferences.guideDelaySeconds}초 후 도움말 · 활동 {interactionCount}회
          </footer>
        )}
      </div>

      {accessibilityOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccessibilityOpen(false); }}>
          <section className="modal access-settings-modal" role="dialog" aria-modal="true" aria-labelledby="access-settings-title">
            <div className="modal-header">
              <div><div className="eyebrow">화면 설정</div><h2 id="access-settings-title">편한 화면 설정</h2><p>원하는 방식으로 화면을 바꿔서 주문할 수 있어요.</p></div>
              <button type="button" className="icon-button" onClick={() => setAccessibilityOpen(false)} aria-label="화면 설정 닫기"><X size={19} /></button>
            </div>
            <div className="access-choice-list">
              <button type="button" className="access-choice" onClick={openQr}>
                <span className="access-choice-icon"><QrCode size={21} /></span>
                <span><strong>내 QR로 설정 불러오기</strong><small>공유받은 주소나 토큰을 입력해요</small></span>
                <ChevronRight size={19} />
              </button>
              <button type="button" className="access-choice" onClick={() => applyQuickPreference("large")}>
                <span className="access-choice-icon"><Accessibility size={21} /></span>
                <span><strong>큰 글씨로 이용하기</strong><small>글씨와 주요 버튼을 크게 바꿔요</small></span>
                <ChevronRight size={19} />
              </button>
              <button type="button" className="access-choice" onClick={() => applyQuickPreference("contrast")}>
                <span className="access-choice-icon"><Sparkles size={20} /></span>
                <span><strong>고대비 화면 사용하기</strong><small>글자와 버튼을 더 뚜렷하게 보여요</small></span>
                <ChevronRight size={19} />
              </button>
            </div>
            <button type="button" className="demo-profile-link" onClick={applyDemoProfile}><Sparkles size={16} /> 모든 편의 설정 한 번에 적용 <span>데모</span></button>
          </section>
        </div>
      )}

      {qrOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeQr(); }}>
          <section className="modal qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title">
            <div className="modal-header">
              <div><div className="eyebrow">QR 설정</div><h2 id="qr-title">내 설정 불러오기</h2><p>카메라로 QR을 스캔하거나 주소와 토큰을 직접 입력할 수 있어요.</p></div>
              <button type="button" className="icon-button" onClick={closeQr} aria-label="설정 불러오기 닫기"><X size={19} /></button>
            </div>
            {qrError && <div className="error-message qr-error" role="alert">{qrError}</div>}
            {qrMode === "camera" ? (
              <>
                <Suspense fallback={<div className="loading-state" role="status"><span className="loading-dot" /> 카메라 스캔을 준비하고 있어요.</div>}>
                  <QrCameraScanner
                    disabled={qrLoading}
                    onScan={handleScannedQr}
                    onCameraUnavailable={handleCameraUnavailable}
                    onRestart={() => setQrError("")}
                  />
                </Suspense>
                <button
                  type="button"
                  className="qr-manual-toggle"
                  onClick={() => {
                    setQrError("");
                    setQrCameraError("");
                    setQrMode("manual");
                  }}
                  disabled={qrLoading}
                >
                  <Smartphone size={18} aria-hidden="true" /> 주소 또는 토큰 직접 입력
                </button>
              </>
            ) : (
              <>
                {qrCameraError && <div className="qr-camera-error" role="alert">{qrCameraError}</div>}
                <button
                  type="button"
                  className="qr-mode-return"
                  onClick={() => {
                    setQrError("");
                    setQrCameraError("");
                    setQrMode("camera");
                  }}
                  disabled={qrLoading}
                >
                  <QrCode size={18} aria-hidden="true" /> 카메라 스캔으로 돌아가기
                </button>
                <form className="qr-manual-form" onSubmit={(event) => { event.preventDefault(); submitManualToken(); }}>
                  <label className="field-label" htmlFor="profile-token">공유 주소 또는 토큰</label>
                  <input
                    id="profile-token"
                    className="text-field"
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                    placeholder="공식 QR 주소 또는 토큰"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={qrLoading}
                  />
                  <p className="qr-manual-note">주소를 입력할 때는 내 방식 QR 서비스에서 받은 공식 주소만 사용할 수 있어요.</p>
                  <div className="modal-actions">
                    <button type="submit" className="primary-button" disabled={qrLoading}>
                      {qrLoading ? "불러오는 중" : "설정 불러오기"} <ArrowRight size={17} />
                    </button>
                  </div>
                </form>
              </>
            )}
            {qrLoading && <div className="loading-state" role="status"><span className="loading-dot" /> 설정을 불러오고 있어요. 잠시만 기다려 주세요.</div>}
            <div className="qr-modal-footer">
              <button type="button" className="demo-profile-link" onClick={applyDemoProfile} disabled={qrLoading}>
                <Accessibility size={17} aria-hidden="true" /> 데모 설정 적용
              </button>
            </div>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-header">
              <div><div className="eyebrow">직원 도움</div><h2 id="help-title">직원 도움이 필요하신가요?</h2><p>직원 호출은 연결되어 있지 않아요. 가까운 직원에게 직접 말씀해 주세요.</p></div>
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
