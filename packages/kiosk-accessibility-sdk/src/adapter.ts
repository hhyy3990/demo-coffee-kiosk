export interface KioskSnapshot {
  screenId: string;
  state?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface KioskAction {
  /** Stable semantic identifier owned by the host kiosk. */
  id: string;
  name: string;
  element: HTMLElement;
  /** Optional outer visual target when the interactive control clips its own highlight. */
  highlightElement?: HTMLElement;
  enabled: boolean;
  primary?: boolean;
}

export interface KioskTextTarget {
  /** Stable semantic identifier; never use visible user data as this value. */
  id: string;
  element: HTMLElement;
}

export interface KioskLayoutRegions {
  bottomControls?: readonly HTMLElement[];
  scrollArea?: HTMLElement | null;
}

export interface AccessibilityAdapter {
  getSnapshot(): KioskSnapshot;
  getActions(): readonly KioskAction[];
  getTextTargets(): readonly KioskTextTarget[];
  getLayoutRegions(): KioskLayoutRegions;
}

export interface AccessibilityGuideMessage {
  title: string;
  text: string;
  /** Must match a currently registered host action. */
  actionId: string | null;
}
