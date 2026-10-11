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
    /** Ordered interactive or informational cards that form the current menu/list. */
    menuItems?: readonly HTMLElement[];
    /** Optional host wording; detection and presentation remain SDK-owned. */
    menuMessage?: string;
    /** Explicitly opted-in containers eligible for min-width/wrapping corrections. */
    reflowContainers?: readonly HTMLElement[];
    /** Explicitly opted-in grid containers whose columns may be reduced on overflow. */
    gridContainers?: readonly HTMLElement[];
    /** Explicitly opted-in groups of adjacent primary controls. */
    actionGroups?: readonly HTMLElement[];
    /** Important controls that may require vertical scrolling to reach. */
    primaryActions?: readonly {
        element: HTMLElement;
        message?: string;
    }[];
    /** Optional semantic mapping when horizontal list controls have ambiguous accessible names. */
    horizontalNavigation?: readonly {
        list: HTMLElement;
        previousButton?: HTMLElement | null;
        nextButton?: HTMLElement | null;
    }[];
    /** Host regions that guidance must not cover (for example fixed headers). */
    guidanceAvoidAreas?: readonly HTMLElement[];
    /** Elements rendered as viewport overlays that must follow an experimental bottom viewport. */
    viewportOverlays?: readonly HTMLElement[];
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
