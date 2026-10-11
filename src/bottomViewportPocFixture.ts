import "@naebangsik/kiosk-accessibility-sdk/styles.css";
import { createAccessibilitySdk, createBottomViewportPoc } from "@naebangsik/kiosk-accessibility-sdk";

const documentRoot = document.querySelector<HTMLElement>("#document-fixture")!;
const nestedRoot = document.querySelector<HTMLElement>("#nested-fixture")!;
const status = document.querySelector<HTMLElement>("#fixture-status")!;
const ratioSelect = document.querySelector<HTMLSelectElement>("#fixture-ratio")!;
const fixtureSelect = document.querySelector<HTMLSelectElement>("#fixture-type")!;
let activePoc: ReturnType<typeof createBottomViewportPoc> | null = null;
let activeSdk: ReturnType<typeof createAccessibilitySdk> | null = null;

for (const root of [documentRoot, nestedRoot]) {
  const cards = root.querySelector<HTMLElement>(".fixture-cards")!;
  cards.innerHTML = Array.from({ length: 14 }, (_, index) =>
    `<article class="fixture-card"><strong>업무 메뉴 ${index + 1}</strong><p>각 항목이 모두 표시되고 마지막 조작까지 접근 가능한지 확인합니다.</p></article>`,
  ).join("");
  root.querySelector(".open-modal")?.addEventListener("click", () => {
    root.querySelector<HTMLElement>(".fixture-modal")!.hidden = false;
  });
  root.querySelector(".close-modal")?.addEventListener("click", () => {
    root.querySelector<HTMLElement>(".fixture-modal")!.hidden = true;
  });
}

function currentRoot(): HTMLElement {
  return fixtureSelect.value === "nested" ? nestedRoot : documentRoot;
}

function updateStatus(): void {
  const root = currentRoot();
  const last = root.querySelector<HTMLElement>("[id$='last-action']")!;
  const rect = last.getBoundingClientRect();
  const visible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  const owner = root.querySelector<HTMLElement>(".fixture-scroll") ??
    root.querySelector<HTMLElement>('[data-a11y-slot="scroll-content"]')!;
  status.textContent = `root=${root.clientHeight}px, scroll=${owner.scrollTop}/${owner.scrollHeight - owner.clientHeight}px, 마지막 조작 화면 내=${visible ? "예" : "아니요"}`;
}

document.querySelector("#fixture-apply")?.addEventListener("click", () => {
  activePoc?.destroy();
  activeSdk?.destroy();
  activePoc = null;
  activeSdk = null;
  documentRoot.hidden = fixtureSelect.value !== "document";
  nestedRoot.hidden = fixtureSelect.value !== "nested";
  const root = currentRoot();
  const lastAction = root.querySelector<HTMLElement>("[id$='last-action']")!;
  const scrollArea = root.querySelector<HTMLElement>(".fixture-scroll") ??
    root.querySelector<HTMLElement>('[data-a11y-slot="scroll-content"]');
  activeSdk = createAccessibilitySdk({
    root,
    adapter: {
      getSnapshot: () => ({ screenId: "fixture" }),
      getActions: () => [{
        id: `${root.id}.last-action`,
        name: "마지막 단계 확인",
        element: lastAction,
        enabled: true,
        primary: true,
      }],
      getTextTargets: () => [],
      getLayoutRegions: () => ({
        scrollArea,
        viewportOverlays: Array.from(root.querySelectorAll<HTMLElement>(".fixture-modal")),
        bottomControls: root.classList.contains("a11y-bottom-controls")
          ? Array.from(root.querySelectorAll<HTMLElement>('[data-a11y-slot="bottom-controls"]'))
          : [],
        menuItems: Array.from(root.querySelectorAll<HTMLElement>(".fixture-card")),
        primaryActions: [{ element: lastAction }],
      }),
    },
  });
  activeSdk.applyProfile({
    textSize: (document.querySelector<HTMLInputElement>("#fixture-extra")!).checked ? "extraLarge" : "standard",
    buttonSize: (document.querySelector<HTMLInputElement>("#fixture-buttons")!).checked ? "large" : "standard",
    contrast: (document.querySelector<HTMLInputElement>("#fixture-contrast")!).checked ? "high" : "standard",
    bottomControls: fixtureSelect.value === "nested",
  });
  root.classList.toggle("a11y-text-extra", (document.querySelector<HTMLInputElement>("#fixture-extra")!).checked);
  root.classList.toggle("a11y-controls-large", (document.querySelector<HTMLInputElement>("#fixture-buttons")!).checked);
  root.classList.toggle("a11y-high-contrast", (document.querySelector<HTMLInputElement>("#fixture-contrast")!).checked);
  activePoc = createBottomViewportPoc({
    root,
    percent: Number(ratioSelect.value) as 60 | 70 | 80,
    adapter: {
      getSnapshot: () => ({ screenId: "fixture" }),
      getActions: () => [],
      getTextTargets: () => [],
      getLayoutRegions: () => ({
        viewportOverlays: Array.from(root.querySelectorAll<HTMLElement>(".fixture-modal")),
      }),
    },
  });
  scrollArea!.scrollTop = 0;
  updateStatus();
});

document.querySelector("#fixture-restore")?.addEventListener("click", () => {
  activePoc?.destroy();
  activeSdk?.destroy();
  activePoc = null;
  activeSdk = null;
  documentRoot.hidden = fixtureSelect.value !== "document";
  nestedRoot.hidden = fixtureSelect.value !== "nested";
  for (const root of [documentRoot, nestedRoot]) {
    root.classList.remove("a11y-text-extra", "a11y-controls-large", "a11y-high-contrast");
    (root.querySelector<HTMLElement>('[data-a11y-slot="scroll-content"]')!).scrollTop = 0;
  }
  updateStatus();
});

document.addEventListener("scroll", updateStatus, { passive: true, capture: true });
for (const root of [documentRoot, nestedRoot]) root.addEventListener("scroll", updateStatus, { passive: true });
window.addEventListener("resize", updateStatus);
