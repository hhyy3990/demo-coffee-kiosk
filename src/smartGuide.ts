export type SmartGuideStage = "start" | "menu" | "options" | "cart" | "payment" | "processing" | "complete";

export type SmartGuideActionId =
  | "start-store"
  | "menu-next-button"
  | `menu-product-${number}`
  | "menu-order-confirm"
  | "item-add"
  | "cart-empty-menu"
  | "cart-pay"
  | "payment-pay"
  | "complete-reset"
  | null;

export interface SmartGuideInput {
  stage: SmartGuideStage;
  cartItemCount: number;
  easyLanguage: boolean;
  simplifiedLayout: boolean;
  menuNavigationActive: boolean;
  menuIndex: number;
  menuCount: number;
  selectedMenuName: string;
  optionsSupported: boolean;
  temperature: "hot" | "iced";
  size: "regular" | "large";
  cup: "store" | "tumbler";
  itemQuantity: number;
}

export interface SmartGuideMessage {
  title: string;
  text: string;
  actionId: SmartGuideActionId;
}

export function resolveSmartGuide(input: SmartGuideInput): SmartGuideMessage | null {
  if (input.stage === "processing") return null;

  if (input.stage === "menu") {
    if (input.cartItemCount > 0) {
      return {
        title: "주문을 마무리할 수 있어요",
        text: "음료를 담았어요! 주문을 마치려면 아래 '주문 확인' 버튼을 눌러주세요.",
        actionId: "menu-order-confirm",
      };
    }

    const menuCount = Math.max(0, Math.floor(input.menuCount));
    const lastIndex = Math.max(0, menuCount - 1);
    const menuIndex = menuCount === 0
      ? 0
      : Math.max(0, Math.min(Math.floor(input.menuIndex), lastIndex));

    if (menuCount > 0 && input.simplifiedLayout && input.menuNavigationActive) {
      if (menuIndex < lastIndex) {
        return {
          title: "다음 메뉴를 확인해 보세요",
          text: "다음 메뉴 보기 버튼을 누르면 다음 메뉴로 이동해요.",
          actionId: "menu-next-button",
        };
      }
      return {
        title: "마지막 메뉴예요",
        text: `${menuCount}번째 메뉴가 마지막이에요. 원하는 메뉴를 고르거나 다른 분류를 확인해 주세요.`,
        actionId: `menu-product-${lastIndex}`,
      };
    }

    return {
      title: "메뉴를 골라 보세요",
      text: input.easyLanguage ? "원하는 메뉴를 골라 주세요." : "분류를 고른 다음 원하는 메뉴를 선택해 주세요.",
      actionId: menuCount > 0 ? `menu-product-${menuIndex}` : null,
    };
  }

  if (input.stage === "options") {
    const quantity = Math.max(1, Math.floor(input.itemQuantity));
    const menuName = input.selectedMenuName || "선택한 메뉴";
    if (!input.optionsSupported) {
      return {
        title: "메뉴를 담을 수 있어요",
        text: `현재 선택: ${menuName}. ${quantity}개를 담으려면 아래 '메뉴 담기' 버튼을 눌러 주세요.`,
        actionId: "item-add",
      };
    }

    const temperature = input.temperature === "hot" ? "따뜻하게" : "차갑게";
    const size = input.size === "large" ? "큰 사이즈" : "보통 사이즈";
    const cup = input.cup === "tumbler" ? "개인 텀블러" : "매장 컵";
    return {
      title: `${menuName} 옵션을 확인해요`,
      text: `현재 선택: ${menuName} · ${temperature} · ${size} · ${cup}. ${quantity}개를 담으려면 아래 '메뉴 담기' 버튼을 눌러 주세요.`,
      actionId: "item-add",
    };
  }

  if (input.stage === "cart") {
    if (input.cartItemCount <= 0) {
      return {
        title: "장바구니가 비었어요",
        text: "메뉴 고르기를 누르면 다시 메뉴를 볼 수 있어요.",
        actionId: "cart-empty-menu",
      };
    }
    return {
      title: "주문을 확인해요",
      text: "수량을 바꾸거나 메뉴를 뺄 수 있어요. 확인이 끝나면 결제로 가요.",
      actionId: "cart-pay",
    };
  }

  if (input.stage === "start") {
    return {
      title: "천천히 골라 보세요",
      text: "매장에서 드실지, 포장하실지 선택하면 메뉴가 열려요.",
      actionId: "start-store",
    };
  }

  if (input.stage === "payment") {
    return {
      title: "결제 방법을 골라요",
      text: "원하는 방법을 선택한 뒤 결제하기를 누르면 돼요.",
      actionId: "payment-pay",
    };
  }

  return {
    title: "주문이 끝났어요",
    text: "영수증을 받을지 고르고 처음 화면으로 돌아갈 수 있어요.",
    actionId: "complete-reset",
  };
}

export function smartGuideDelayMs(seconds: 10 | 15 | 20): number {
  return seconds * 1000;
}
