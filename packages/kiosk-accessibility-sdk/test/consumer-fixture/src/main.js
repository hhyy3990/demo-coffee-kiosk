import {
  ACCESSIBILITY_PROFILE_SCHEMA_VERSION,
  ACCESSIBILITY_SDK_VERSION,
  DEFAULT_ACCESSIBILITY_PROFILE,
  createAccessibilitySdk,
  validateAccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
import "./host.css";

const root = document.querySelector("#kiosk-root");
const continueButton = document.querySelector("#host-continue");
const hostState = { step: "review", actionCount: 0 };
let keypadClicks = 0;
let quantity = 1;
let optionChanges = 0;
const guidePlacementDiagnostics = [];

continueButton.addEventListener("click", () => {
  hostState.actionCount += 1;
  document.querySelector("#host-state").textContent = `업무 작업 ${hostState.actionCount}회`;
});
root.querySelectorAll(".keypad button").forEach((button) => button.addEventListener("click", () => {
  keypadClicks += 1;
}));
root.querySelectorAll(".fixture-choices input").forEach((input) => input.addEventListener("change", () => {
  optionChanges += 1;
}));
document.querySelector("#quantity-minus").addEventListener("click", () => {
  quantity = Math.max(1, quantity - 1);
  document.querySelector("#quantity-count").textContent = String(quantity);
});
document.querySelector("#quantity-plus").addEventListener("click", () => {
  quantity += 1;
  document.querySelector("#quantity-count").textContent = String(quantity);
});

const adapter = {
  getSnapshot: () => ({
    screenId: hostState.step === "start" ? "start" : `host.${hostState.step}`,
    state: { step: hostState.step, actionCount: hostState.actionCount },
  }),
  getActions: () => [{
    id: "host.review.continue",
    name: "계속",
    element: continueButton,
    enabled: !continueButton.disabled,
    primary: true,
  }],
  getTextTargets: () => [...root.querySelectorAll("[data-a11y-text]")].map((element) => ({
    id: element.dataset.a11yId,
    element,
  })),
    getLayoutRegions: () => ({
      bottomControls: [document.querySelector(".bottom-controls")],
      scrollArea: document.querySelector(".content"),
      viewportOverlays: [...root.querySelectorAll(".fixture-modal")],
      primaryActions: [
        continueButton,
        root.querySelector("#test-pin"),
        ...root.querySelectorAll(".keypad button"),
        ...root.querySelectorAll(".fixture-choices input"),
        ...root.querySelectorAll(".fixture-quantity button"),
      ].filter(Boolean).map((element) => ({ element })),
      menuItems: [...root.querySelectorAll(".fixture-menu-item")],
      guidanceAvoidAreas: [root.querySelector(".keypad")].filter(Boolean),
    }),
};

const sdk = createAccessibilitySdk({
  root,
  adapter,
  onDiagnostics: (issues) => guidePlacementDiagnostics.push(
    ...issues.filter((issue) => issue.issueType === "guide-suppressed"),
  ),
});
let profile = validateAccessibilityProfile({
  ...DEFAULT_ACCESSIBILITY_PROFILE,
  textSize: "extraLarge",
  buttonSize: "large",
  contrast: "high",
  easyLanguage: true,
  bottomControls: true,
  smartGuide: true,
  guideDelaySeconds: 10,
});

sdk.applyProfile(profile);
const easyExplanations = [
  { title: "확인 단계", text: "입력한 내용을 확인하는 화면입니다." },
  { title: "다음으로 이동", text: "내용이 맞으면 계속 버튼을 누릅니다." },
  { title: "도움 요청", text: "어려우면 직원에게 도움을 요청할 수 있습니다." },
];
const certificateCopy = {
  startScreen: {
    stepId: "start",
    explanations: [
      { title: "쉬운 말 안내가 켜져 있어요.", text: "업무를 선택하면 어려운 말을 쉽게 설명해 드려요." },
    ],
  },
  typeSelection: {
    stepId: "certificate.type-selection",
    explanations: [
      { title: "주민등록표 등본", text: "주민등록표 등본은 한 세대의 구성과 주소 정보를 확인하는 주민등록 서류입니다." },
      { title: "주민등록표 초본", text: "초본 발급은 아직 준비 중입니다. 이 데모에서는 등본만 진행할 수 있습니다." },
    ],
  },
  idInput: {
    stepId: "certificate.id-input",
    explanations: [
      { title: "주민등록번호", text: "주민등록번호는 주민을 구분하는 데 쓰는 13자리 번호입니다. 실제 번호는 입력하지 마세요." },
      { title: "입력한 숫자 보호", text: "입력한 숫자는 화면에서 점으로 표시됩니다. 데모에는 임의 숫자만 사용하며, 화면을 나가거나 처음 화면으로 돌아가면 입력값이 지워집니다." },
      { title: "입력 수정", text: "‘정정’은 마지막 숫자 하나를 지우고, ‘전체 삭제’는 입력한 숫자를 모두 지웁니다." },
    ],
  },
};
const guideStep = "host.review.continue";
sdk.setEasyLanguageState({ stepId: guideStep, explanations: easyExplanations });
sdk.setGuideState({
  stepId: guideStep,
  enabled: profile.smartGuide,
  paused: true,
  delaySeconds: profile.guideDelaySeconds,
  message: {
    title: "다음 단계",
    text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
    actionId: "host.review.continue",
  },
});

document.querySelector("#sdk-status").textContent =
  `SDK ${ACCESSIBILITY_SDK_VERSION} · 프로필 ${ACCESSIBILITY_PROFILE_SCHEMA_VERSION} · 초기화 완료`;

window.__sdkPackageSmoke = {
  loadQrScanner: () => import("@naebangsik/kiosk-accessibility-sdk/qr-scanner"),
  async runQrContract() {
    const { mountQrScanner } = await import("@naebangsik/kiosk-accessibility-sdk/qr-scanner");
    const host = document.createElement("div");
    root.append(host);
    const controls = { stops: 0, stop() { this.stops += 1; } };
    const found = [];
    const scanner = mountQrScanner({
      container: host,
      readerFactory: () => ({
        decodeFromVideoDevice(_device, _video, callback) {
          queueMicrotask(() => {
            callback({ getText: () => "https://naebangsikqr.replit.app/profile?token=consumer-test" }, undefined, controls);
            callback({ getText: () => "duplicate" }, undefined, controls);
          });
          return Promise.resolve(controls);
        },
      }),
      onScan: (value) => found.push(value),
      onCameraUnavailable() {},
    });
    await scanner.start();
    const scanResult = { count: found.length, stoppedTracks: controls.stops, text: found[0] };
    scanner.destroy();

    let cameraError = "";
    const deniedScanner = mountQrScanner({
      container: host,
      readerFactory: () => ({
        decodeFromVideoDevice: async () => { throw new DOMException("denied", "NotAllowedError"); },
      }),
      onScan() {},
      onCameraUnavailable: (message) => { cameraError = message; },
    });
    await deniedScanner.start();
    const permissionFallback = { message: cameraError, manualFallbackAvailable: true };
    deniedScanner.destroy();
    const qrClient = createQrProfileClient({
      fetcher: async (url) => {
        if (url !== "/api/qr-profile") throw new Error("Unexpected profile endpoint");
        return new Response(JSON.stringify({ preferences: profile }), { status: 200 });
      },
    });
    const invalidRejected = await qrClient.resolve("https://attacker.example/?token=x", "scan")
      .then(() => false, (error) => error.message === "QR_UNAVAILABLE");
    const loadedProfile = await qrClient.resolve(
      "https://naebangsikqr.replit.app/profile?token=consumer-test",
      "scan",
    );
    return {
      scanResult,
      permissionFallback,
      invalidRejected,
      profileLoaded: loadedProfile.textSize === "extraLarge",
      scannerContainersCleaned: host.childNodes.length === 0,
    };
  },
  async runStageGuidanceProbe(heightPercent = null, guideMode = "easy") {
    const enableEasy = guideMode !== "smart";
    const enableSmart = guideMode !== "easy";
    root.classList.add("stage-fixture");
    const stage = root.querySelector(".content");
    const next = root.querySelector("#host-continue");
    profile = validateAccessibilityProfile({
      ...profile,
      viewportMode: heightPercent === null ? null : { mode: "bottom", heightPercent },
      easyLanguage: enableEasy,
      smartGuide: enableSmart,
      slowGuidance: true,
      guideDelaySeconds: 10,
    });
    sdk.applyProfile(profile);
    if (enableEasy) sdk.setEasyLanguageState({
        stepId: guideStep,
        explanations: [{ title: "확인 단계", text: "입력한 내용을 확인한 뒤 계속 진행합니다." }],
      });
    const guideMessage = {
      title: "다음 단계",
      text: "내용을 확인한 뒤 계속 버튼을 눌러 주세요.",
      actionId: "host.review.continue",
    };
    sdk.setGuideState({
      stepId: guideStep, enabled: enableSmart, paused: true,
      delaySeconds: 10, message: guideMessage,
    });
    const frame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sample = async (state, requestedTop) => {
      stage.scrollTop = requestedTop;
      await frame();
      const guide = root.querySelector(".a11y-guide-toast");
      const hint = document.querySelector(".a11y-additional-menu-hint");
      const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null;
      const stageRect = stage.getBoundingClientRect();
      const actions = [...root.querySelectorAll(".keypad button, .fixture-choices input, .fixture-quantity button, #host-continue")];
      const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left &&
        a.top < b.bottom && a.bottom > b.top;
      const guideRect = rect(guide);
      const hintRect = rect(hint);
      const hitTests = actions.map((element) => {
        const r = element.getBoundingClientRect();
        const left = Math.max(r.left, stageRect.left, 0);
        const right = Math.min(r.right, stageRect.right, innerWidth);
        const top = Math.max(r.top, stageRect.top, 0);
        const bottom = Math.min(r.bottom, stageRect.bottom, innerHeight);
        const visible = right > left && bottom > top;
        if (!visible) return { id: element.id || element.textContent.trim(), visible, hit: true,
          guideOverlap: false, hintOverlap: false };
        const x = left + (right - left) / 2;
        const y = top + (bottom - top) / 2;
        const hit = document.elementFromPoint(x, y);
        const label = element instanceof HTMLInputElement ? element.labels?.[0] : null;
        return {
          id: element.id || element.textContent.trim(), visible,
          hit: hit === element || element.contains(hit) || Boolean(label?.contains(hit)),
          guideOverlap: guide?.isConnected && getComputedStyle(guide).visibility === "visible" &&
            overlaps(r, guideRect),
          hintOverlap: hint?.isConnected && getComputedStyle(hint).visibility === "visible" &&
            overlaps(r, hintRect),
        };
      });
      return {
        state, requestedTop, scrollTop: stage.scrollTop,
        stage: rect(stage), scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight,
        guide: guide ? { rect: rect(guide), smart: guide.classList.contains("a11y-guide-smart"),
          visible: getComputedStyle(guide).visibility === "visible" } : null,
        hint: hint ? { rect: rect(hint), visible: getComputedStyle(hint).visibility === "visible" } : null,
        nextAction: rect(next), hitTests,
      };
    };
    const max = stage.scrollHeight - stage.clientHeight;
    const tops = [0, 240, 480, max, 0].map((top) => Math.min(max, top));
    const easy = [];
    for (const top of tops) easy.push(await sample("easy", top));
    let smartVisible = false;
    if (enableSmart) {
      sdk.setGuideState({
        stepId: guideStep, enabled: true, paused: false,
        delaySeconds: 0, message: guideMessage,
      });
      for (let attempt = 0; attempt < 115; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        smartVisible = Boolean(root.querySelector(".a11y-guide-toast.a11y-guide-smart"));
        if (smartVisible) break;
      }
    }
    const smart = [];
    if (smartVisible && enableSmart) {
      for (const top of tops) smart.push(await sample("smart", top));
    }
    return { viewport: { width: innerWidth, height: innerHeight },
      stageScrollHeight: stage.scrollHeight, stageClientHeight: stage.clientHeight,
      maxScroll: Math.max(0, stage.scrollHeight - stage.clientHeight),
      noSafeSpace: root.dataset.a11yScrollGuidance === "no-safe-space",
      guideMode,
      smartVisible, easy, smart };
  },
  async runPanelStabilityProbe(heightPercent = null, deepAudit = false) {
    root.classList.add("stage-fixture");
    const stage = root.querySelector(".content");
    const dock = document.createElement("aside");
    dock.dataset.a11yQrEntryDock = "true";
    dock.textContent = "QR 도크 fixture";
    Object.assign(dock.style, {
      position: "fixed", zIndex: "25", left: "0", right: "0", bottom: "88px",
      height: "64px", display: "grid", placeItems: "center",
      background: "#eee", borderTop: "1px solid #999",
    });
    document.body.append(dock);
    const footerTop = root.querySelector(".bottom-controls").getBoundingClientRect().top;
    dock.style.bottom = `${innerHeight - footerTop}px`;
    profile = validateAccessibilityProfile({
      ...profile, textSize: "extraLarge", buttonSize: "large", contrast: "high",
      viewportMode: heightPercent === null ? null : { mode: "bottom", heightPercent },
      easyLanguage: true, smartGuide: true, slowGuidance: true,
    });
    sdk.applyProfile(profile);
    const explanations = [
      { title: "짧은 안내", text: "첫 페이지입니다." },
      { title: "긴 안내", text: "이 안내는 페이지별 길이 차이를 재현하기 위해 길게 작성했습니다. ".repeat(18) },
      { title: "마지막 안내", text: "세 번째 페이지입니다. ".repeat(7) },
    ];
    sdk.setEasyLanguageState({ stepId: guideStep, explanations });
    const frame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sample = async (state) => {
      await frame();
      const panel = root.querySelector(".a11y-guide-toast");
      const rect = panel?.getBoundingClientRect();
      const buttonRects = ["[data-a11y-guide-previous]", "[data-a11y-guide-next]",
        "[data-a11y-guide-collapse]"].map((selector) => {
        const button = panel?.querySelector(selector);
        const box = button?.getBoundingClientRect();
        let ancestor = button;
        let hidden = !button || button.hidden;
        while (ancestor && !hidden) {
          hidden = getComputedStyle(ancestor).display === "none" ||
            getComputedStyle(ancestor).visibility === "hidden";
          ancestor = ancestor.parentElement;
        }
        return { selector, hidden,
          width: box?.width ?? 0, height: box?.height ?? 0 };
      });
      const text = panel?.querySelector("[data-a11y-guide-text]");
      const textStyle = text ? getComputedStyle(text) : null;
      const result = {
        state,
        top: rect?.top ?? null,
        bottom: rect?.bottom ?? null,
        height: rect?.height ?? null,
        page: panel?.querySelector("[data-a11y-guide-page]")?.textContent ?? "",
        title: panel?.querySelector("[data-a11y-guide-title]")?.textContent ?? "",
        text: text?.textContent ?? "",
        visible: Boolean(panel && getComputedStyle(panel).visibility === "visible"),
        overflow: panel ? getComputedStyle(panel).overflow : "",
        scrollable: Boolean(panel && ["auto", "scroll"].includes(getComputedStyle(panel).overflowY)),
        collapsed: Boolean(panel?.classList.contains("a11y-guide-collapsed")),
        bodyScrollable: Boolean(panel && panel.scrollHeight > panel.clientHeight),
        buttons: buttonRects,
      };
      return result;
    };
    const samples = [await sample("페이지 1")];
    root.querySelector("[data-a11y-guide-next]")?.click();
    samples.push(await sample("다음→페이지 2"));
    const originalLongText = explanations[1].text;
    const collectedLongText = [samples[1].text];
    const pageCount = Number(samples[1].page.split("/")[1] || 1);
    if (pageCount > 200) throw new Error(`Long-copy pagination generated ${pageCount} pages.`);
    let cursor = samples[1];
    let longPageIndex = 2;
    while (cursor.title === explanations[1].title) {
      root.querySelector("[data-a11y-guide-next]")?.click();
      cursor = await sample(`긴 안내 페이지 ${longPageIndex + 1}`);
      if (cursor.title === explanations[1].title) collectedLongText.push(cursor.text);
      longPageIndex += 1;
      if (!deepAudit) break;
    }
    while (Number(cursor.page.split("/")[0] || 0) > 2) {
      root.querySelector("[data-a11y-guide-previous]")?.click();
      cursor = await sample("긴 안내 복귀");
    }
    root.querySelector("[data-a11y-guide-previous]")?.click();
    samples.push(await sample("이전→페이지 1"));
    root.querySelector("[data-a11y-guide-next]")?.click();
    samples.push(await sample("다음→페이지 2 재방문"));
    root.querySelector("[data-a11y-guide-collapse]")?.click();
    samples.push(await sample("접기"));
    root.querySelector("[data-a11y-guide-collapse]")?.click();
    samples.push(await sample("펼치기"));
    sdk.setGuideState({
      stepId: guideStep, enabled: true, paused: false, delaySeconds: 0,
      message: { title: "스마트 길잡이", text: "현재 단계의 다음 동작을 안내합니다.", actionId: "host.review.continue" },
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (root.querySelector(".a11y-guide-toast.a11y-guide-smart")) break;
    }
    samples.push(await sample("스마트 길잡이 시작"));
    sdk.setGuideState({
      stepId: guideStep, enabled: false, paused: true, delaySeconds: 10, message: null,
    });
    samples.push(await sample("쉬운 말 복원"));
    stage.scrollTop = stage.scrollHeight;
    await frame();
    const hint = document.querySelector(".a11y-additional-menu-hint");
    const hintRect = hint?.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const footerRect = root.querySelector(".bottom-controls").getBoundingClientRect();
    const collectedText = collectedLongText.join("");
    let firstTextDifference = 0;
    while (firstTextDifference < Math.min(originalLongText.length, collectedText.length) &&
      originalLongText[firstTextDifference] === collectedText[firstTextDifference]) firstTextDifference += 1;
    const report = {
      viewport: { width: innerWidth, height: innerHeight },
      heightPercent: heightPercent ?? null,
      samples,
      pageCount, originalLongText, collectedLongText: collectedText, deepAudit,
      firstTextDifference,
      textDifference: {
        index: firstTextDifference,
        expectedCodePoint: originalLongText.codePointAt(firstTextDifference),
        actualCodePoint: collectedText.codePointAt(firstTextDifference),
        expected: originalLongText.slice(Math.max(0, firstTextDifference - 20), firstTextDifference + 40),
        actual: collectedText.slice(Math.max(0, firstTextDifference - 20), firstTextDifference + 40),
      },
      longTextLengths: { original: originalLongText.length,
        collected: collectedText.length },
      hint: { visible: Boolean(hint && getComputedStyle(hint).visibility === "visible"),
        top: hintRect?.top ?? null, bottom: hintRect?.bottom ?? null,
        position: hint ? getComputedStyle(hint).position : "" },
      dock: { top: dockRect.top, bottom: dockRect.bottom },
      footer: { top: footerRect.top, bottom: footerRect.bottom },
    };
    dock.remove();
    return report;
  },
  async runViewportReflowProbe() {
    const frame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sentence = "화면에 표시된 안내를 차근차근 읽고 필요한 내용을 확인해 주세요. ";
    let longText = "";
    while (longText.length < 2_823) longText += sentence;
    const anchorTitle = "읽던 위치 기준";
    const anchorText = "읽던 위치.";
    const explanations = [
      { title: "긴 안내", text: longText },
      { title: anchorTitle, text: anchorText },
      { title: "마지막 안내", text: "마지막 안내 문장입니다." },
    ];
    profile = validateAccessibilityProfile({
      ...profile, textSize: "extraLarge", buttonSize: "large", contrast: "high",
      easyLanguage: true, smartGuide: true, slowGuidance: true, viewportMode: null,
    });
    sdk.setViewportMode(null);
    sdk.applyProfile(profile);
    sdk.setEasyLanguageState({ stepId: guideStep, explanations });
    const panel = () => root.querySelector(".a11y-guide-toast");
    const title = () => panel()?.querySelector("[data-a11y-guide-title]")?.textContent ?? "";
    const text = () => panel()?.querySelector("[data-a11y-guide-text]")?.textContent ?? "";
    const page = () => panel()?.querySelector("[data-a11y-guide-page]")?.textContent ?? "";
    const next = () => panel()?.querySelector("[data-a11y-guide-next]");
    const previous = () => panel()?.querySelector("[data-a11y-guide-previous]");
    const findAnchor = () => {
      for (let i = 0; i < 200; i += 1) {
        if (title() === anchorTitle) return true;
        if (next()?.disabled) return false;
        next()?.click();
      }
      return false;
    };
    if (!findAnchor() || text() !== anchorText) throw new Error("Could not locate the reading-position marker.");
    await frame();
    const transitions = [];
    const auditedModes = new Set();
    const fromModes = [null, 80, 60, 70, null, 60, 80, 70, 60, null, 70, 80];
    const toModes = [80, 60, 70, null, 60, 80, 70, 60, null, 70, 80, null];
    const sample = () => {
      const box = panel()?.getBoundingClientRect();
      const copy = panel()?.querySelector("[data-a11y-guide-text]");
      const range = document.createRange();
      if (copy) range.selectNodeContents(copy);
      const textBox = copy ? range.getBoundingClientRect() : null;
      const controls = ["[data-a11y-guide-previous]", "[data-a11y-guide-next]",
        "[data-a11y-guide-collapse]"].map((selector) => {
        const button = panel()?.querySelector(selector);
        const rect = button?.getBoundingClientRect();
        return { hidden: Boolean(button?.hidden), width: rect?.width ?? 0,
          height: rect?.height ?? 0, top: rect?.top ?? 0, bottom: rect?.bottom ?? 0 };
      });
      return { title: title(), text: text(), page: page(), top: box?.top ?? null,
        height: box?.height ?? null, bottom: box?.bottom ?? null,
        textTop: textBox?.top ?? null, textBottom: textBox?.bottom ?? null,
        overflow: panel() ? getComputedStyle(panel()).overflow : "",
        bodyScrollable: Boolean(panel() && panel().scrollHeight > panel().clientHeight),
        collapsed: Boolean(panel()?.classList.contains("a11y-guide-collapsed")), controls };
    };
    for (let index = 0; index < toModes.length; index += 1) {
      const before = sample();
      const target = toModes[index];
      if (!sdk.setViewportMode(target === null ? null : { mode: "bottom", heightPercent: target })) {
        throw new Error(`Viewport mode rejected: ${target ?? "normal"}`);
      }
      await frame();
      const after = sample();
      if (after.title !== anchorTitle || after.text !== anchorText) {
        throw new Error(`Reading marker lost on ${fromModes[index] ?? "normal"}→${target ?? "normal"}: ${JSON.stringify(after)}`);
      }
      const reportedPageCount = Number(page().split("/")[1] || 1);
      if (!auditedModes.has(target)) {
        while (!previous()?.disabled) previous()?.click();
        const collected = [];
        for (let i = 0; i < 200; i += 1) {
          const pageSample = sample();
          if (pageSample.title === "긴 안내") {
            collected.push(pageSample.text);
            const pageTextClipped = pageSample.textTop < pageSample.top - 1 ||
              pageSample.textBottom > pageSample.bottom + 1;
            const pageButtonsOutside = pageSample.controls.some((control) => !control.hidden &&
              (control.width < 44 || control.height < 44 ||
                control.top < pageSample.top - 1 || control.bottom > pageSample.bottom + 1));
            if (pageTextClipped || pageButtonsOutside || pageSample.overflow !== "hidden" ||
                pageSample.bodyScrollable) {
              throw new Error(`Long-copy page clipped on ${target ?? "normal"}: ${JSON.stringify(pageSample)}`);
            }
          }
          if (next()?.disabled) break;
          next()?.click();
        }
        const allText = collected.join("");
        if (allText !== longText) {
          throw new Error(`Long copy changed on ${fromModes[index] ?? "normal"}→${target ?? "normal"} (${allText.length}/${longText.length}).`);
        }
        auditedModes.add(target);
        while (!previous()?.disabled) previous()?.click();
        if (!findAnchor()) throw new Error(`Reading-position explanation disappeared after ${target ?? "normal"} transition.`);
      }
      const settled = sample();
      const outside = settled.controls.filter((control) => !control.hidden &&
        (control.width < 44 || control.height < 44 ||
          control.top < settled.top - 1 || control.bottom > settled.bottom + 1));
      const textClipped = settled.textTop < settled.top - 1 || settled.textBottom > settled.bottom + 1;
      const expectedTop = target === null ? 12 : 8;
      const result = {
        from: fromModes[index], to: target, beforeHeight: before.height, afterHeight: after.height,
        beforePageCount: Number(before.page.split("/")[1] || 1), pageCount: reportedPageCount,
        originalLength: longText.length, textPreserved: auditedModes.has(target),
        anchorPreserved: settled.title === anchorTitle && settled.text === anchorText,
        textClipped, outside, panelTop: settled.top, expectedTop, overflow: settled.overflow,
        bodyScrollable: settled.bodyScrollable, collapsed: settled.collapsed,
      };
      transitions.push(result);
      if (textClipped || outside.length || settled.overflow !== "hidden" ||
          settled.bodyScrollable || settled.collapsed || Math.abs(settled.top - expectedTop) > 1) {
        throw new Error(`Viewport reflow layout failed: ${JSON.stringify(result)}`);
      }
    }
    return { viewport: { width: innerWidth, height: innerHeight }, transitions };
  },
  read() {
    return {
      profile,
      classes: [...root.classList].filter((name) => name.startsWith("a11y-")),
      actionCount: hostState.actionCount,
      keypadClicks,
      quantity,
      optionChanges,
      guidePlacementDiagnostics,
      guideVisible: Boolean(root.querySelector(".a11y-guide-toast")),
      actionHighlighted: continueButton.classList.contains("a11y-guide-emphasis"),
      diagnostics: sdk.inspectLayout(),
    };
  },
  readInteractionState() {
    const scrollOwner = root.querySelector(".a11y-bottom-viewport-scroll-area") ??
      root.querySelector(".content");
    return { keypadClicks, quantity, optionChanges, scrollTop: scrollOwner?.scrollTop ?? window.scrollY,
      guide: this.readGuidance() };
  },
  scrollTestOwner(amount) {
    const scrollOwner = root.querySelector(".a11y-bottom-viewport-scroll-area") ??
      root.querySelector(".content");
    scrollOwner?.scrollBy(0, amount);
    return scrollOwner?.scrollTop ?? window.scrollY;
  },
  updateGuideCopy(text) {
    sdk.setGuideState({
      stepId: guideStep,
      enabled: profile.smartGuide,
      paused: false,
      delaySeconds: profile.guideDelaySeconds,
      message: {
        title: "다음 단계",
        text,
        actionId: "host.review.continue",
      },
    });
  },
  readGuidance() {
    const panel = root.querySelector(".a11y-guide-toast");
    const rect = panel?.getBoundingClientRect();
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const measure = (selector) => {
      const element = panel?.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height } : null;
    };
    const measureText = (selector) => {
      const element = panel?.querySelector(selector);
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height, text: element.textContent?.trim() ?? "" };
    };
    return {
      visible: Boolean(panel && panelStyle?.display !== "none" && panelStyle?.visibility === "visible" &&
        Number(panelStyle.opacity) > 0 && rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < innerHeight),
      panelVisibility: panelStyle?.visibility ?? "",
      panelOpacity: panelStyle?.opacity ?? "",
      ariaHidden: panel?.getAttribute("aria-hidden") ?? "",
      suppressed: panel?.dataset.a11yPositionSuppressed === "true",
      title: panel?.querySelector("[data-a11y-guide-title]")?.textContent ?? "",
      text: panel?.querySelector("[data-a11y-guide-text]")?.textContent ?? "",
      textVisible: Boolean(panel?.querySelector("[data-a11y-guide-text]")?.getClientRects().length &&
        getComputedStyle(panel.querySelector("[data-a11y-guide-text]")).display !== "none"),
      page: panel?.querySelector("[data-a11y-guide-page]")?.textContent ?? "",
      collapsed: panel?.classList.contains("a11y-guide-collapsed") ?? false,
      pagerHidden: panel?.querySelector("[data-a11y-guide-pager]")?.hidden ?? true,
      previousHidden: panel?.querySelector("[data-a11y-guide-previous]")?.hidden ?? true,
      nextHidden: panel?.querySelector("[data-a11y-guide-next]")?.hidden ?? true,
      countdown: panel?.querySelector("[data-a11y-guide-countdown]")?.textContent ?? "",
      panelRect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      headerRect: measure(".a11y-guide-header"),
      titleRect: measure("[data-a11y-guide-title]"),
      iconRect: measure(".a11y-guide-icon"),
      iconAriaHidden: panel?.querySelector(".a11y-guide-icon")?.getAttribute("aria-hidden") ?? "",
      countdownRect: measure("[data-a11y-guide-countdown]"),
      collapseRect: measure("[data-a11y-guide-collapse]"),
      collapseTextRect: measureText("[data-a11y-guide-collapse]"),
      collapseLabel: panel?.querySelector("[data-a11y-guide-collapse]")?.textContent ?? "",
      collapseAccessibleName: panel?.querySelector("[data-a11y-guide-collapse]")?.getAttribute("aria-label") ?? "",
      closeRect: measure(".a11y-guide-close"),
      closeTextRect: measureText(".a11y-guide-close"),
      closeLabel: panel?.querySelector(".a11y-guide-close")?.getAttribute("aria-label") ?? "",
      textRect: measure("[data-a11y-guide-text]"),
      textMetrics: (() => {
        const element = panel?.querySelector("[data-a11y-guide-text]");
        if (!element) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = element.getBoundingClientRect();
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY,
          lineHeight: getComputedStyle(element).lineHeight,
          lineRects: [...range.getClientRects()].map(({ top, bottom, height }) => ({ top, bottom, height })),
          top: rect.top,
          bottom: rect.bottom,
        };
      })(),
      previousRect: measure("[data-a11y-guide-previous]"),
      previousTextRect: measureText("[data-a11y-guide-previous]"),
      nextRect: measure("[data-a11y-guide-next]"),
      nextTextRect: measureText("[data-a11y-guide-next]"),
      pageRect: measure("[data-a11y-guide-page]"),
      titleFontSize: panel ? getComputedStyle(panel.querySelector("[data-a11y-guide-title]")).fontSize : "",
      bodyFontSize: panel ? getComputedStyle(panel.querySelector("[data-a11y-guide-text]")).fontSize : "",
      actionRect: (() => {
        const button = continueButton.getBoundingClientRect();
        return { left: button.left, top: button.top, right: button.right, bottom: button.bottom };
      })(),
      keypadRect: (() => {
        const keypad = root.querySelector(".keypad")?.getBoundingClientRect();
        return keypad ? { left: keypad.left, top: keypad.top, right: keypad.right, bottom: keypad.bottom } : null;
      })(),
    };
  },
  startGuide(
    slow = false,
    delaySeconds = 10,
    text = "계속 버튼을 눌러 진행하세요.",
    stepId = guideStep,
  ) {
    const current = validateAccessibilityProfile({ ...profile, slowGuidance: slow });
    sdk.applyProfile(current);
    sdk.setEasyLanguageState({ stepId, explanations: easyExplanations });
    sdk.setGuideState({
      stepId,
      enabled: true,
      paused: false,
      delaySeconds,
      message: { title: "스마트 길잡이", text, actionId: "host.review.continue" },
    });
    return performance.now();
  },
  setViewport(percent) {
    return sdk.setViewportMode(percent ? { mode: "bottom", heightPercent: percent } : null);
  },
  setTestProfile(overrides = {}, stepId = guideStep) {
    profile = validateAccessibilityProfile({ ...profile, ...overrides });
    sdk.applyProfile(profile);
    sdk.setEasyLanguageState({ stepId, explanations: easyExplanations });
    sdk.setGuideState({
      stepId,
      enabled: profile.smartGuide,
      paused: true,
      delaySeconds: 10,
      message: { title: "스마트 길잡이", text: "계속 버튼을 눌러 진행하세요.", actionId: "host.review.continue" },
    });
    return profile;
  },
  setCertificateCopy(caseName, viewportChoice = "80") {
    const selected = certificateCopy[caseName];
    if (!selected) throw new Error(`Unknown certificate-copy fixture: ${caseName}`);
    if (selected.stepId === "start") hostState.step = "start";
    const viewportMode = viewportChoice === "auto"
      ? null
      : { mode: "bottom", heightPercent: Number(viewportChoice) };
    profile = validateAccessibilityProfile({
      ...profile,
      textSize: "extraLarge",
      buttonSize: "large",
      contrast: "high",
      easyLanguage: true,
      smartGuide: true,
      viewportMode,
    });
    sdk.applyProfile(profile);
    sdk.notifyScreenChange(selected.stepId);
    sdk.setEasyLanguageState({ stepId: selected.stepId, explanations: selected.explanations });
    sdk.setGuideState({
      stepId: selected.stepId,
      enabled: true,
      paused: true,
      delaySeconds: 10,
      message: { title: "다음 단계", text: "계속 버튼을 눌러 진행하세요.", actionId: "host.review.continue" },
    });
    return { ...selected, viewportMode };
  },
  moveToStep(step) {
    sdk.notifyScreenChange(step);
    sdk.setEasyLanguageState({
      stepId: step,
      explanations: [{ title: "새 단계", text: "새 화면의 안내입니다." }],
    });
    sdk.setGuideState({
      stepId: step,
      enabled: true,
      paused: true,
      delaySeconds: 10,
      message: { title: "새 단계 안내", text: "새 화면 내용을 확인하세요.", actionId: "host.review.continue" },
    });
  },
  endSession() {
    const actionCount = hostState.actionCount;
    sdk.endSession();
    return { panelVisible: Boolean(root.querySelector(".a11y-guide-toast")), actionCount: hostState.actionCount };
  },
  destroy() {
    sdk.destroy();
    return [...root.classList];
  },
};
