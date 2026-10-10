import assert from "node:assert/strict";
import test from "node:test";
import { resolveCafeGuide } from "./accessibility/cafeAdapter.ts";
import { smartGuideDelayMs } from "../packages/kiosk-accessibility-sdk/src/guide.ts";

const base = {
  stage: "menu",
  cartItemCount: 0,
  easyLanguage: false,
  menuIndex: 0,
  menuCount: 5,
  selectedMenuName: "아메리카노",
  optionsSupported: true,
  temperature: "hot",
  size: "regular",
  cup: "store",
  itemQuantity: 1,
};

test("빈 장바구니 메뉴 화면은 메뉴 선택을 안내하고 실제 메뉴를 강조한다", () => {
  const guide = resolveCafeGuide(base);
  assert.equal(guide?.text, "분류를 고른 다음 원하는 메뉴를 선택해 주세요.");
  assert.equal(guide?.actionId, "menu-product-0");
});

test("옵션 화면은 선택한 옵션과 메뉴 담기 버튼을 안내한다", () => {
  const guide = resolveCafeGuide({ ...base, stage: "options", temperature: "iced", size: "large", cup: "tumbler", itemQuantity: 2 });
  assert.match(guide?.text || "", /아메리카노 · 차갑게 · 큰 사이즈 · 개인 텀블러/);
  assert.match(guide?.text || "", /2개를 담으려면.*메뉴 담기/);
  assert.equal(guide?.actionId, "item-add");
});

test("메뉴 화면에 음료 한 개가 있으면 주문 확인으로 우선 안내한다", () => {
  const guide = resolveCafeGuide({ ...base, cartItemCount: 1 });
  assert.equal(guide?.text, "음료를 담았어요! 주문을 마치려면 아래 '주문 확인' 버튼을 눌러주세요.");
  assert.equal(guide?.actionId, "menu-order-confirm");
});

test("메뉴 화면에 여러 상품이 있어도 메뉴 선택 대신 주문 확인을 안내한다", () => {
  const guide = resolveCafeGuide({ ...base, cartItemCount: 2 });
  assert.equal(guide?.actionId, "menu-order-confirm");
  assert.doesNotMatch(guide?.text || "", /메뉴를 골라|다음 메뉴 보기/);
});

test("메뉴 위치에 따라 스마트 길잡이가 현재 보이는 메뉴를 가리킨다", () => {
  const guide = resolveCafeGuide({ ...base, menuIndex: 3 });
  assert.equal(guide?.actionId, "menu-product-3");
});

test("장바구니 화면은 결제 버튼을, 빈 장바구니는 메뉴 버튼을 가리킨다", () => {
  const populated = resolveCafeGuide({ ...base, stage: "cart", cartItemCount: 2 });
  const empty = resolveCafeGuide({ ...base, stage: "cart", cartItemCount: 0 });
  assert.equal(populated?.actionId, "cart-pay");
  assert.equal(empty?.actionId, "cart-empty-menu");
});

test("QR 프로필의 10초, 15초, 20초 지연값을 정확히 적용한다", () => {
  assert.equal(smartGuideDelayMs(10), 10_000);
  assert.equal(smartGuideDelayMs(15), 15_000);
  assert.equal(smartGuideDelayMs(20), 20_000);
});

test("각 주문 단계는 실제 화면의 다음 행동 ID를 제공하고 자동 처리 단계는 안내하지 않는다", () => {
  assert.equal(resolveCafeGuide({ ...base, stage: "start" })?.actionId, "start-store");
  assert.equal(resolveCafeGuide({ ...base, stage: "payment" })?.actionId, "payment-pay");
  assert.equal(resolveCafeGuide({ ...base, stage: "complete" })?.actionId, "complete-reset");
  assert.equal(resolveCafeGuide({ ...base, stage: "processing" }), null);
});
