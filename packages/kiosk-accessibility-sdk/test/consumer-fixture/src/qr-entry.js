import {
  createAccessibilitySdk,
  createQrEntryDock,
  createQrProfileClient,
  DEFAULT_ACCESSIBILITY_PROFILE,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
import "./qr-entry.css";

const params = new URLSearchParams(location.search);
const structure = params.get("structure") || "inner";
const percentValue = params.get("percent");
const percent = ["60", "70", "80"].includes(percentValue) ? Number(percentValue) : null;
const documentHost = structure === "document";
const fixedControlsHost = structure === "fixed-controls" || structure === "stage-root-fixed";
const stageRootHost = structure === "stage-root" || structure === "stage-root-fixed";
const hostTail = params.get("hostTail") === "1";
const fontCorrection = params.get("fontCorrection") || "none";
const documentModeUsesInner = documentHost && percent !== null;
let screenId = "consumer.menu";
let useDocumentScroll = documentHost && !documentModeUsesInner;
document.body.classList.toggle("document-host", documentHost);
document.body.classList.toggle("fixed-controls-host", fixedControlsHost);
document.body.classList.toggle("host-tail", hostTail);
document.body.classList.toggle("correction-fit", fontCorrection === "fit");
document.body.classList.toggle("correction-fail", fontCorrection === "fail");
document.body.classList.toggle("correction-14-fit", fontCorrection === "14fit");
document.body.classList.toggle("correction-16-fit", fontCorrection === "16fit");
document.body.dataset.qrScrollOwner = documentModeUsesInner ? "inner" : "document";

const content = document.querySelector(".content");
const supportingCopy = document.querySelector("#supporting-copy");
if (fontCorrection === "14fit") supportingCopy.style.fontSize = "9.333333px";
if (fontCorrection === "16fit") supportingCopy.style.fontSize = "10.666667px";
const root = documentHost ? document.body : stageRootHost ? content : document.querySelector("#kiosk-root");
const controls = document.querySelector(".bottom-controls");
const list = document.querySelector("#menu-list");
const extraTextTargets = [];
let extraActions = [];
let extraCorrectionTargets = [];
for (let index = 1; index <= 18; index += 1) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.textContent = `메뉴 ${index}`;
  button.dataset.menuIndex = String(index);
  if (index === 18) button.id = "last-menu";
  list.append(button);
}
if (hostTail) {
  const notice = document.createElement("aside");
  notice.className = "host-tail-notice";
  notice.textContent = "이용 안내: 마지막 메뉴 뒤에도 필요한 내용을 확인할 수 있습니다.";
  list.after(notice);
}

let qrClicks = 0;
let lastMenuClicks = 0;
const adapter = {
  getSnapshot: () => ({ screenId }),
  getActions: () => [
    ...[...document.querySelectorAll(".menu-item")].map((element, index) => ({
      id: `menu.${index}`, name: element.textContent, element, enabled: true,
    })),
    ...extraActions,
  ],
  getTextTargets: () => [{ id: "consumer.supporting-copy", element: supportingCopy }, ...extraTextTargets],
  getFontCorrectionTargets: () => [
    ...(fontCorrection === "none" ? [] : [{ id: "consumer.supporting-copy", element: supportingCopy }]),
    ...extraCorrectionTargets,
  ],
  getLayoutRegions: () => ({
    bottomControls: fixedControlsHost ? [controls] : [],
    scrollArea: useDocumentScroll ? null : content,
    guidanceAvoidAreas: [...document.querySelectorAll("[data-a11y-qr-entry-dock]")],
    viewportOverlays: [...document.querySelectorAll(".fixture-modal")],
    menuItems: [...document.querySelectorAll(".menu-item")],
  }),
};
const dock = createQrEntryDock({
  root,
  adapter,
  active: false,
  onOpenQr: () => { qrClicks += 1; },
});
dock.setActive(true);
document.querySelector("#last-menu").addEventListener("click", () => { lastMenuClicks += 1; });
const baseProfile = {
  ...DEFAULT_ACCESSIBILITY_PROFILE,
  textSize: "extraLarge",
  buttonSize: "large",
  contrast: "high",
};
const mockQrProfile = async (schemaVersion, heightPercent) => {
  const preferences = schemaVersion === 3
    ? {
      textSize: "extraLarge",
      buttonSize: "large",
      contrast: "high",
      easyLanguage: false,
      viewportMode: heightPercent === null ? null : { mode: "bottom", heightPercent },
      smartGuide: true,
      guideDelaySeconds: 10,
      voiceGuidance: false,
    }
    : {
      textSize: "extraLarge",
      buttonSize: "large",
      contrast: "high",
      easyLanguage: false,
      bottomControls: true,
      smartGuide: true,
      guideDelaySeconds: 10,
      voiceGuidance: false,
    };
  const client = createQrProfileClient({
    fetcher: async () => new Response(JSON.stringify({
      schemaVersion, updatedAt: "2026-10-12T00:00:00.000Z", preferences,
    }), { status: 200 }),
  });
  return client.resolve("consumer-v3-token-123456789", "manual");
};
const sdk = documentHost && percent === null
  ? null
  : createAccessibilitySdk({ root, adapter });
if (sdk && (!documentHost || percent !== null)) {
  if (percent === null) {
    sdk.applyProfile(baseProfile);
  } else {
    const qrProfile = await mockQrProfile(3, percent);
    sdk.applyProfile({ ...baseProfile, ...qrProfile });
  }
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
await frame();
dock.setActive(false);
await frame();
const restoredAfterDisable = !document.querySelector("[data-a11y-qr-entry-dock]") &&
  !root.classList.contains("a11y-qr-entry-dock-home");
dock.setActive(true);
await frame();

const getScrollOwner = () => {
  if (!documentHost || documentModeUsesInner) return content;
  const documentRange = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  return documentRange > 0 ? document.scrollingElement : document.body;
};
window.qrConsumerTest = {
  structure,
  percent,
  restoredAfterDisable,
  get() {
    const dockNode = document.querySelector(".a11y-qr-entry-dock");
    const dockButton = dockNode?.querySelector("button");
    const last = document.querySelector("#last-menu");
    const owner = getScrollOwner();
    const ownerRect = owner === document.scrollingElement
      ? { top: 0, bottom: innerHeight, toJSON: () => ({ top: 0, bottom: innerHeight }) }
      : owner.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const controlRect = controls.getBoundingClientRect();
    const safeBottom = Math.min(
      ownerRect.bottom,
      dockNode?.getBoundingClientRect().top ?? innerHeight,
      fixedControlsHost ? controlRect.top : innerHeight,
    );
    return {
      structure,
      percent,
      restoredAfterDisable,
      rootActive: root.classList.contains("a11y-qr-entry-dock-home"),
      dockCount: document.querySelectorAll("[data-a11y-qr-entry-dock]").length,
      dockFixed: !!dockNode && getComputedStyle(dockNode).position === "fixed",
      dockRect: dockNode?.getBoundingClientRect().toJSON() ?? null,
      qrButtonHeight: dockButton?.getBoundingClientRect().height ?? 0,
      documentRange: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyRange: document.body.scrollHeight - document.body.clientHeight,
      ownerRange: owner.scrollHeight - owner.clientHeight,
      ownerScrollTop: owner.scrollTop,
      ownerTag: owner === document.scrollingElement ? "HTML" : owner.tagName,
      ownerRect: ownerRect.toJSON(),
      lastRect: lastRect.toJSON(),
      lastVisible: lastRect.top >= ownerRect.top - 1 && lastRect.bottom <= safeBottom + 1,
      lastHit: document.elementFromPoint(
        Math.max(1, Math.min(innerWidth - 2, lastRect.left + lastRect.width / 2)),
        Math.max(1, Math.min(innerHeight - 2, lastRect.top + lastRect.height / 2)),
      ) === last,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      fixedControlsVisible: !fixedControlsHost || controlRect.top >= (dockNode?.getBoundingClientRect().bottom ?? 0) - 1,
      qrClicks,
      lastMenuClicks,
      rootHeight: root.getBoundingClientRect().height,
      guidanceEnabled: Boolean(sdk),
      qrViewportMode: sdk?.profile.viewportMode ?? null,
      qrViewportApplied: percent === null || (!!sdk &&
        sdk.profile.viewportMode?.heightPercent === percent &&
        root.classList.contains("a11y-bottom-viewport-enabled")),
      dockBottomMode: root.classList.contains("a11y-qr-entry-dock-bottom"),
      dockContentHeight: root.style.getPropertyValue("--a11y-qr-entry-dock-content-height"),
      supportingFont: getComputedStyle(document.querySelector("#supporting-copy")).fontSize,
      menuActionFont: getComputedStyle(document.querySelector(".menu-item")).fontSize,
      supportingBox: (() => {
        const el = document.querySelector("#supporting-copy");
        return { rect: el.getBoundingClientRect().toJSON(), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, lineHeight: getComputedStyle(el).lineHeight, overflow: getComputedStyle(el).overflowY };
      })(),
      supportingCorrections: sdk?.getLastLayoutCorrections().filter((item) => item.strategy === "supporting-copy-font") ?? [],
      diagnostics: sdk?.inspectLayout() ?? [],
      viewportRect: content.getBoundingClientRect().toJSON(),
      viewportInset: Number.parseFloat(content.style.getPropertyValue("--a11y-bottom-viewport-bottom-inset")) || 0,
      dockScrollSpacerHeight: Number.parseFloat(getComputedStyle(content, "::after").height) || 0,
      dockScrollSpacerContent: getComputedStyle(content, "::after").content,
      scrollAreaHasDockClass: content.classList.contains("a11y-qr-entry-dock-scroll-area"),
      scrollAreaHasViewportClass: content.classList.contains("a11y-bottom-viewport-scroll-area"),
      hostTail,
      hostNoticeRect: document.querySelector(".host-tail-notice")?.getBoundingClientRect().toJSON() ?? null,
      hintVisible: Boolean(sdk) && !!document.querySelector(".a11y-additional-menu-hint") &&
        getComputedStyle(document.querySelector(".a11y-additional-menu-hint")).visibility === "visible",
      hintRect: document.querySelector(".a11y-additional-menu-hint")?.getBoundingClientRect().toJSON() ?? null,
      hintPointerEvents: document.querySelector(".a11y-additional-menu-hint")
        ? getComputedStyle(document.querySelector(".a11y-additional-menu-hint")).pointerEvents : null,
      noSafeSpace: root.dataset.a11yScrollGuidance === "no-safe-space",
      hintPassesDockClick: (() => {
        const button = dockNode?.querySelector("button");
        if (!button) return true;
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return button === hit || button.contains(hit);
      })(),
      hintAvoidsDockAndControls: (() => {
        const hint = document.querySelector(".a11y-additional-menu-hint");
        if (!hint) return false;
        const r = hint.getBoundingClientRect();
        return [dockNode, fixedControlsHost ? controls : null].filter(Boolean).every((el) => {
          const o = el.getBoundingClientRect();
          return !(r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
        });
      })(),
    };
  },
  async guidanceOverlayPriority(kind) {
    const overlay = document.createElement("aside");
    overlay.className = kind === "guide" ? "a11y-guide-toast a11y-guide-smart" : "fixture-modal";
    overlay.textContent = kind === "modal" ? "모달 스크롤 콘텐츠 ".repeat(80) : kind;
    if (kind === "modal") {
      overlay.style.overflow = "auto";
      overlay.style.fontSize = "24px";
    }
    root.append(overlay);
    if (kind === "guide") {
      await new Promise((resolve) => setTimeout(resolve, 350));
      sdk.applyProfile(sdk.profile);
    }
    await frame();
    const hintVisible = () => {
      const hint = document.querySelector(".a11y-additional-menu-hint");
      return Boolean(hint && hint.getAttribute("aria-hidden") !== "true" &&
        getComputedStyle(hint).visibility !== "hidden");
    };
    const hidden = !hintVisible();
    if (kind === "modal") {
      overlay.scrollTop = Math.min(120, overlay.scrollHeight - overlay.clientHeight);
      await frame();
    }
    const modalOwnsScroll = kind === "modal" &&
      overlay.scrollHeight > overlay.clientHeight && overlay.scrollTop > 0 && hintVisible();
    overlay.remove();
    if (kind === "guide") sdk.applyProfile(sdk.profile);
    await frame();
    return { hidden, returns: hintVisible(), modalOwnsScroll };
  },
  async verifyDockless() {
    dock.setActive(false);
    await frame();
    const result = this.get();
    return {
      visible: result.hintVisible,
      noSafeSpace: result.noSafeSpace,
      qrDockAbsent: !document.querySelector("[data-a11y-qr-entry-dock]"),
      controlsStillReachable: result.fixedControlsVisible,
      hintPassesDockClick: result.hintPassesDockClick,
    };
  },
  async verifyQrProfileReplacement() {
    if (!sdk) return { pass: false, reason: "SDK unavailable" };
    const apply = async (version, height) => {
      const profile = await mockQrProfile(version, height);
      sdk.applyProfile(profile);
      await frame();
      return { mode: sdk.profile.viewportMode, viewport: content.getBoundingClientRect().toJSON() };
    };
    const modes = [];
    modes.push(await apply(3, 60));
    modes.push(await apply(3, 70));
    const repeatedSeventy = await apply(3, 70);
    modes.push(await apply(3, 80));
    modes.push(await apply(3, null));
    const nullRestored = !root.classList.contains("a11y-bottom-viewport-enabled");
    await apply(3, 80);
    modes.push(await apply(2, 70));
    const legacyRestored = !root.classList.contains("a11y-bottom-viewport-enabled");
    await apply(3, 80);
    sdk.endSession();
    await frame();
    const ended = !root.classList.contains("a11y-bottom-viewport-enabled") &&
      sdk.profile.viewportMode === null;
    modes.push(await apply(3, 60));
    const reactivated = sdk.profile.viewportMode?.heightPercent === 60 &&
      root.classList.contains("a11y-bottom-viewport-enabled");
    return {
      modes,
      nullRestored,
      legacyRestored,
      ended,
      reactivated,
      repeatedSeventy: repeatedSeventy.mode?.heightPercent === 70 &&
        repeatedSeventy.viewport.height === modes[1].viewport.height,
      noAccumulation: modes[0].viewport.height === modes[5].viewport.height,
      pass: nullRestored && legacyRestored && ended && reactivated &&
        repeatedSeventy.mode?.heightPercent === 70 &&
        repeatedSeventy.viewport.height === modes[1].viewport.height &&
        modes[0].mode?.heightPercent === 60 &&
        modes[1].mode?.heightPercent === 70 &&
        modes[2].mode?.heightPercent === 80 &&
        modes[3].mode === null &&
        modes[4].mode === null &&
        modes[5].mode?.heightPercent === 60 &&
        modes[0].viewport.height === modes[5].viewport.height,
    };
  },
  async verifyScreenTransitions(switchScrollOwner = false) {
    if (!sdk) return { pass: false };
    const settle = async (count = 12) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };
    const activeOwner = () => {
      if (useDocumentScroll) return document.scrollingElement;
      return content;
    };
    const topVisible = () => {
      const heading = content.querySelector("h1").getBoundingClientRect();
      const port = useDocumentScroll
        ? { top: 0, bottom: innerHeight }
        : content.getBoundingClientRect();
      return heading.top >= port.top - 1 && heading.top < port.bottom;
    };
    screenId = "consumer.start";
    const first = sdk.notifyScreenChange(screenId);
    await settle();
    let owner = activeOwner();
    owner.scrollTop = 110;
    await settle(2);
    screenId = "consumer.task";
    content.querySelector("h1").textContent = "새 업무 화면 제목";
    dock.setActive(false);
    const second = sdk.notifyScreenChange(screenId);
    await settle();
    owner = activeOwner();
    const afterTransition = {
      oldScrollTop: content.scrollTop,
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
      activeScrollTop: owner.scrollTop,
      headingTop: content.querySelector("h1").getBoundingClientRect().top,
      headingVisible: topVisible(),
      dockRemoved: !document.querySelector("[data-a11y-qr-entry-dock]"),
    };
    owner.scrollTop = 72;
    const repeated = sdk.notifyScreenChange(screenId);
    await settle(3);
    const sameScreenScrollTop = owner.scrollTop;
    const modal = document.createElement("aside");
    modal.className = "fixture-modal";
    root.append(modal);
    await settle(2);
    const modalScrollTop = owner.scrollTop;
    modal.remove();
    await settle(2);
    const closedModalScrollTop = owner.scrollTop;
    screenId = "consumer.user-scroll";
    const interrupted = sdk.notifyScreenChange(screenId);
    owner.scrollTop = 46;
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    await settle(3);
    const userScrollPreserved = owner.scrollTop === 46;

    let ownerSwitch = null;
    if (switchScrollOwner && percent === null) {
      useDocumentScroll = true;
      document.body.classList.add("force-document-scroll");
      screenId = "consumer.long-document";
      content.querySelector("h1").textContent = "문서 스크롤 화면 제목";
      await settle(2);
      document.scrollingElement.scrollTop = 95;
      const documentChanged = sdk.notifyScreenChange(screenId);
      await settle();
      const documentTop = document.scrollingElement.scrollTop;

      useDocumentScroll = false;
      document.body.classList.remove("force-document-scroll");
      screenId = "consumer.inner-again";
      content.querySelector("h1").textContent = "내부 스크롤 화면 제목";
      await settle(2);
      content.scrollTop = 88;
      const innerChanged = sdk.notifyScreenChange(screenId);
      await settle();
      ownerSwitch = {
        documentChanged,
        documentTop,
        innerChanged,
        innerTop: content.scrollTop,
        titleVisible: topVisible(),
      };
    }

    screenId = "consumer.start";
    content.querySelector("h1").textContent = "독립 키오스크 메뉴";
    dock.setActive(true);
    const returned = sdk.notifyScreenChange(screenId);
    await settle();
    const homeTitleVisible = topVisible();
    return {
      first, second, repeated, afterTransition, sameScreenScrollTop,
      modalScrollTop, closedModalScrollTop, interrupted, userScrollPreserved,
      ownerSwitch, returned, homeTitleVisible,
      pass: first && second && !repeated &&
        afterTransition.activeScrollTop === 0 && afterTransition.headingVisible &&
        afterTransition.dockRemoved && sameScreenScrollTop === 72 &&
        modalScrollTop === 72 && closedModalScrollTop === 72 &&
        interrupted && userScrollPreserved &&
        (!switchScrollOwner || !ownerSwitch || (
          ownerSwitch.documentChanged && ownerSwitch.documentTop === 0 &&
          ownerSwitch.innerChanged && ownerSwitch.innerTop === 0 && ownerSwitch.titleVisible
        )) && returned && homeTitleVisible,
    };
  },
  async verifySessionScreenReset() {
    if (!sdk) return { pass: false };
    sdk.endSession();
    screenId = "consumer.start";
    content.scrollTop = 54;
    const notified = sdk.notifyScreenChange(screenId);
    for (let index = 0; index < 12; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      notified,
      scrollTop: content.scrollTop,
      defaultProfileRestored: sdk.profile.textSize === DEFAULT_ACCESSIBILITY_PROFILE.textSize,
      pass: notified && content.scrollTop === 0 &&
        sdk.profile.textSize === DEFAULT_ACCESSIBILITY_PROFILE.textSize,
    };
  },
  clickQr() { document.querySelector(".a11y-qr-entry-dock-button").click(); },
  restoreCorrectionProfile() {
    sdk?.applyProfile(DEFAULT_ACCESSIBILITY_PROFILE);
    const el = document.querySelector("#supporting-copy");
    return { fontSize: getComputedStyle(el).fontSize, inlineFontSize: el.style.getPropertyValue("font-size"), inlineLineHeight: el.style.getPropertyValue("line-height") };
  },
  diagnoseOverlap(kind) {
    extraActions = kind === "button"
      ? [{ id: "footer.action.0", name: "이전 단계", element: controls.querySelector("button"), enabled: true }]
      : [];
    const target = document.createElement("p");
    target.dataset.testTarget = kind;
    target.textContent = "도움 안내";
    Object.assign(target.style, { position: "fixed", width: "10px", height: "10px", overflow: "visible", margin: "0", padding: "0", font: "10px/10px sans-serif", zIndex: "50" });
    const footer = controls.getBoundingClientRect();
    const dockNode = document.querySelector(".a11y-qr-entry-dock");
    if (kind === "button") {
      const button = controls.querySelector("button").getBoundingClientRect();
      target.style.left = `${button.left + 4}px`;
      target.style.top = `${button.top + 4}px`;
      target.style.width = "60px";
      target.style.height = "20px";
    } else if (kind === "parent") {
      target.style.left = "1px";
      target.style.top = `${footer.top + 4}px`;
    } else {
      target.style.left = "1px";
      target.style.top = `${dockNode.getBoundingClientRect().top + 4}px`;
    }
    root.append(target);
    extraTextTargets.push({ id: `consumer.overlay.${kind}`, element: target });
    return sdk.inspectLayout().filter((issue) => issue.semanticId === `consumer.overlay.${kind}`);
  },
  async testMultipleCopy(registeredCount) {
    extraTextTargets.length = 0;
    extraCorrectionTargets.length = 0;
    extraActions = [];
    document.querySelectorAll("[data-test-target]").forEach((element) => element.remove());
    document.querySelectorAll(".test-fixed-copy-area").forEach((element) => element.remove());
    const fixedArea = document.createElement("aside");
    fixedArea.className = "test-fixed-copy-area";
    fixedArea.style.cssText = "position:fixed;left:max(20px, calc((100vw - 680px) / 2 + 20px));top:300px;width:240px;height:80px;overflow:visible";
    const texts = [1, 2].map((index) => {
      const el = document.createElement("p");
      el.textContent = `안내 ${index}`;
      el.style.cssText = `position:absolute;left:${(index - 1) * 90}px;top:0;width:70px;height:18px;margin:0;padding:0;overflow:hidden;line-height:1;font-size:9.333333px`;
      fixedArea.append(el);
      const item = { id: `consumer.fixed-copy.${index}`, element: el };
      extraTextTargets.push(item);
      if (index <= registeredCount) extraCorrectionTargets.push(item);
      return el;
    });
    root.append(fixedArea);
    sdk.applyProfile(baseProfile);
    await frame();
    const corrections = sdk.getLastLayoutCorrections().filter((item) => item.strategy === "supporting-copy-font" &&
      item.targetId?.startsWith("consumer.fixed-copy."));
    return {
      fonts: texts.map((el) => getComputedStyle(el).fontSize),
      boxes: texts.map((el) => ({
        clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
        lineHeight: getComputedStyle(el).lineHeight, height: el.getBoundingClientRect().height,
      })),
      corrections,
      diagnosticIds: sdk.inspectLayout().filter((issue) => issue.issueType === "text-clipped" &&
        issue.semanticId.startsWith("consumer.fixed-copy.")).map((issue) => issue.semanticId),
    };
  },
  async verifyCorrectionSessionRestore() {
    sdk.applyProfile(baseProfile);
    await frame();
    const before = getComputedStyle(document.querySelector(".test-fixed-copy-area p")).fontSize;
    sdk.endSession();
    await frame();
    const after = [...document.querySelectorAll(".test-fixed-copy-area p")].map((el) => ({
      font: getComputedStyle(el).fontSize,
      inlineFont: el.style.getPropertyValue("font-size"),
      inlineLineHeight: el.style.getPropertyValue("line-height"),
    }));
    return { before, after };
  },
  destroy() { dock.destroy(); },
};
