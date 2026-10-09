# Kiosk Accessibility SDK

Framework-independent TypeScript helpers for applying the existing 내 방식 QR accessibility profile schema to a web kiosk.

The SDK only manages presentation, inactivity timing, guide display, browser speech, and read-only layout diagnostics. It does not own kiosk workflow state or execute registered actions.

## Install in a Vite/TypeScript kiosk

Install this package from a local checkout or a package registry:

```sh
npm install ../path/to/project/packages/kiosk-accessibility-sdk
```

Import the runtime and its scoped stylesheet:

```ts
import {
  createAccessibilitySdk,
  type AccessibilityAdapter,
  type AccessibilityProfile,
} from "@naebangsik/kiosk-accessibility-sdk";
import "@naebangsik/kiosk-accessibility-sdk/styles.css";
```

The package ships TypeScript source. Use a TypeScript-aware bundler such as Vite, and configure its dependency optimizer to include the package if the host project needs that for development.

## Host adapter

The host provides the current screen snapshot, semantic action IDs and their DOM elements, diagnostic text targets, and layout regions:

```ts
const sdk = createAccessibilitySdk({
  root: document.querySelector<HTMLElement>("#kiosk-root")!,
  adapter: {
    getSnapshot: () => ({ screenId: "catalog", state: { itemCount: 0 } }),
    getActions: () => [{
      id: "catalog.continue",
      name: "다음",
      element: document.querySelector<HTMLElement>("[data-a11y-action-id='catalog.continue']")!,
      enabled: true,
      primary: true,
    }],
    getTextTargets: () => [],
    getLayoutRegions: () => ({ bottomControls: [], scrollArea: null }),
  },
});

sdk.applyProfile(profile);
sdk.setGuideState({
  enabled: profile.smartGuide,
  paused: false,
  delaySeconds: profile.guideDelaySeconds,
  message: { title: "안내", text: "다음 버튼을 눌러 주세요.", actionId: "catalog.continue" },
});

const issues = sdk.inspectLayout();
sdk.destroy();
```

The host remains responsible for profile retrieval. For 내 방식 QR, call the kiosk's same-origin server proxy; do not make a browser request directly to the central profile resolver. Keep the existing profile fields and values unchanged.

## Style integration

The SDK toggles `a11y-*` classes on its root element and scopes its CSS beneath `.kiosk`. Give the kiosk root that class, import the SDK stylesheet, and mark host regions with:

- `data-a11y-slot="scroll-content"`
- `data-a11y-slot="bottom-controls"`
- `data-a11y-slot="above-bottom-controls"`
- `data-a11y-text` and `data-a11y-id="stable.semantic.id"` for diagnostic text
- `data-a11y-action-id="stable.semantic.id"` for action targets

The host still owns its own responsive grid and any kiosk-specific content rearrangement.
