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
const fixedControlsHost = structure === "fixed-controls";
const documentModeUsesInner = documentHost && percent !== null;
document.body.classList.toggle("document-host", documentHost);
document.body.classList.toggle("fixed-controls-host", fixedControlsHost);
document.body.dataset.qrScrollOwner = documentModeUsesInner ? "inner" : "document";

const root = documentHost ? document.body : document.querySelector("#kiosk-root");
const content = document.querySelector(".content");
const controls = document.querySelector(".bottom-controls");
const list = document.querySelector("#menu-list");
for (let index = 1; index <= 18; index += 1) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.textContent = `메뉴 ${index}`;
  button.dataset.menuIndex = String(index);
  if (index === 18) button.id = "last-menu";
  list.append(button);
}

let qrClicks = 0;
let lastMenuClicks = 0;
const adapter = {
  getSnapshot: () => ({ screenId: "consumer.menu" }),
  getActions: () => [...document.querySelectorAll(".menu-item")].map((element, index) => ({
    id: `menu.${index}`, name: element.textContent, element, enabled: true,
  })),
  getTextTargets: () => [],
  getLayoutRegions: () => ({
    bottomControls: fixedControlsHost ? [controls] : [],
    scrollArea: documentHost && !documentModeUsesInner ? null : content,
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
      viewportRect: content.getBoundingClientRect().toJSON(),
      viewportInset: Number.parseFloat(content.style.getPropertyValue("--a11y-bottom-viewport-bottom-inset")) || 0,
      hintVisible: Boolean(sdk) && !!document.querySelector(".a11y-additional-menu-hint") &&
        getComputedStyle(document.querySelector(".a11y-additional-menu-hint")).visibility === "visible",
      hintRect: document.querySelector(".a11y-additional-menu-hint")?.getBoundingClientRect().toJSON() ?? null,
      hintPointerEvents: document.querySelector(".a11y-additional-menu-hint")
        ? getComputedStyle(document.querySelector(".a11y-additional-menu-hint")).pointerEvents : null,
      noSafeSpace: root.dataset.a11yScrollGuidance === "no-safe-space",
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
    overlay.className = kind === "guide" ? "a11y-guide-toast" : "fixture-modal";
    overlay.textContent = kind;
    root.append(overlay);
    if (kind === "guide") {
      await new Promise((resolve) => setTimeout(resolve, 350));
      sdk.applyProfile(sdk.profile);
    }
    await frame();
    const hidden = !document.querySelector(".a11y-additional-menu-hint");
    overlay.remove();
    if (kind === "guide") sdk.applyProfile(sdk.profile);
    await frame();
    return { hidden, returns: !!document.querySelector(".a11y-additional-menu-hint") };
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
  clickQr() { document.querySelector(".a11y-qr-entry-dock-button").click(); },
  destroy() { dock.destroy(); },
};
