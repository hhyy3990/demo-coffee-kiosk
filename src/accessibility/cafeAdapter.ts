import type {
  AccessibilityAdapter,
  AccessibilityGuideMessage,
  KioskAction,
  KioskTextTarget,
} from "@naebangsik/kiosk-accessibility-sdk";

export type CafeStage =
  | "start"
  | "menu"
  | "options"
  | "cart"
  | "payment"
  | "processing"
  | "complete";

export interface CafeGuideInput {
  stage: CafeStage;
  cartItemCount: number;
  easyLanguage: boolean;
  menuIndex: number;
  menuCount: number;
  selectedMenuName: string;
  optionsSupported: boolean;
  temperature: "hot" | "iced";
  size: "regular" | "large";
  cup: "store" | "tumbler";
  itemQuantity: number;
}

export interface CafeAdapterState extends CafeGuideInput {
  categoryId: string;
}

function message(
  title: string,
  text: string,
  actionId: string | null,
): AccessibilityGuideMessage {
  return { title, text, actionId };
}

export function resolveCafeGuide(input: CafeGuideInput): AccessibilityGuideMessage | null {
  if (input.stage === "processing") return null;

  if (input.stage === "menu") {
    if (input.cartItemCount > 0) {
      return message(
        "주문을 마무리할 수 있어요",
        "음료를 담았어요! 주문을 마치려면 아래 '주문 확인' 버튼을 눌러주세요.",
        "menu-order-confirm",
      );
    }

    const menuCount = Math.max(0, Math.floor(input.menuCount));
    const lastIndex = Math.max(0, menuCount - 1);
    const menuIndex = menuCount === 0
      ? 0
      : Math.max(0, Math.min(Math.floor(input.menuIndex), lastIndex));

    return message(
      "메뉴를 골라 보세요",
      input.easyLanguage ? "원하는 메뉴를 골라 주세요." : "분류를 고른 다음 원하는 메뉴를 선택해 주세요.",
      menuCount > 0 ? `menu-product-${menuIndex}` : null,
    );
  }

  if (input.stage === "options") {
    const quantity = Math.max(1, Math.floor(input.itemQuantity));
    const menuName = input.selectedMenuName || "선택한 메뉴";
    if (!input.optionsSupported) {
      return message(
        "메뉴를 담을 수 있어요",
        `현재 선택: ${menuName}. ${quantity}개를 담으려면 아래 '메뉴 담기' 버튼을 눌러 주세요.`,
        "item-add",
      );
    }

    const temperature = input.temperature === "hot" ? "따뜻하게" : "차갑게";
    const size = input.size === "large" ? "큰 사이즈" : "보통 사이즈";
    const cup = input.cup === "tumbler" ? "개인 텀블러" : "매장 컵";
    return message(
      `${menuName} 옵션을 확인해요`,
      `현재 선택: ${menuName} · ${temperature} · ${size} · ${cup}. ${quantity}개를 담으려면 아래 '메뉴 담기' 버튼을 눌러 주세요.`,
      "item-add",
    );
  }

  if (input.stage === "cart") {
    return input.cartItemCount <= 0
      ? message("장바구니가 비었어요", "메뉴 고르기를 누르면 다시 메뉴를 볼 수 있어요.", "cart-empty-menu")
      : message("주문을 확인해요", "수량을 바꾸거나 메뉴를 뺄 수 있어요. 확인이 끝나면 결제로 가요.", "cart-pay");
  }

  if (input.stage === "start") {
    return message("천천히 골라 보세요", "매장에서 드실지, 포장하실지 선택하면 메뉴가 열려요.", "start-store");
  }

  if (input.stage === "payment") {
    return message("결제 방법을 골라요", "원하는 방법을 선택한 뒤 결제하기를 누르면 돼요.", "payment-pay");
  }

  return message("주문이 끝났어요", "영수증을 받을지 고르고 처음 화면으로 돌아갈 수 있어요.", "complete-reset");
}

function readableName(button: HTMLButtonElement, fallback: string): string {
  return button.getAttribute("aria-label")?.trim() ||
    button.textContent?.replace(/\s+/g, " ").trim() ||
    fallback;
}

export function createCafeAccessibilityAdapter(
  getRoot: () => HTMLElement | null,
  getState: () => CafeAdapterState,
): AccessibilityAdapter {
  const getButtons = (): KioskAction[] => {
    const root = getRoot();
    if (!root) return [];
    const screenId = `cafe.${getState().stage}`;

    return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).map((element, index) => {
      const id =
        element.dataset.a11yActionId ||
        element.id ||
        `${screenId}.button.${index + 1}`;
      return {
        id,
        name: readableName(element, id),
        element,
        highlightElement: element.closest<HTMLElement>("[data-a11y-highlight-container]") ?? element,
        enabled: !element.disabled,
        primary: element.dataset.a11yPrimary === "true",
      };
    });
  };

  return {
    getSnapshot() {
      const state = getState();
      return {
        screenId: `cafe.${state.stage}`,
        state: {
          cartItemCount: state.cartItemCount,
          categoryId: state.categoryId,
          easyLanguage: state.easyLanguage,
          menuIndex: state.menuIndex,
          menuCount: state.menuCount,
          selectedMenuName: state.selectedMenuName,
          optionsSupported: state.optionsSupported,
          temperature: state.temperature,
          size: state.size,
          cup: state.cup,
          itemQuantity: state.itemQuantity,
        },
      };
    },
    getActions: getButtons,
    getTextTargets(): KioskTextTarget[] {
      const root = getRoot();
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>("[data-a11y-text]")).map((element, index) => ({
        id: element.dataset.a11yId || `cafe.text.${index + 1}`,
        element,
      }));
    },
    getLayoutRegions() {
      const root = getRoot();
      if (!root) return { bottomControls: [], scrollArea: null };
      const bottomControls = root.classList.contains("a11y-bottom-controls")
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-a11y-slot="bottom-controls"]'))
        : [];
      return {
        viewportOverlays: Array.from(root.querySelectorAll<HTMLElement>(".modal-backdrop")),
        bottomControls,
        scrollArea: root.querySelector<HTMLElement>('[data-a11y-slot="scroll-content"]'),
        menuItems: getState().stage === "menu"
          ? Array.from(root.querySelectorAll<HTMLElement>(".product-card"))
          : [],
        primaryActions: getState().stage === "payment"
          ? [{
              element: root.querySelector<HTMLElement>("#payment-pay")!,
            }]
          : [],
        horizontalNavigation: getState().stage === "menu"
          ? [{
              list: root.querySelector<HTMLElement>("#category-nav-list")!,
              previousButton: root.querySelector<HTMLElement>("#category-nav-list")?.parentElement?.querySelector<HTMLElement>(".category-scroll-button:first-child"),
              nextButton: root.querySelector<HTMLElement>("#category-nav-list")?.parentElement?.querySelector<HTMLElement>(".category-scroll-button:last-child"),
            }]
          : [],
        reflowContainers: [root.querySelector<HTMLElement>('[data-a11y-slot="scroll-content"]')].filter(
          (element): element is HTMLElement => Boolean(element),
        ),
        gridContainers: Array.from(root.querySelectorAll<HTMLElement>(".product-grid, .payment-grid")),
      };
    },
  };
}
