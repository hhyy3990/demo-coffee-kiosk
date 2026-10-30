const EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATTEMPT_STORAGE_PREFIX = "democoffee:production-ai-attempt:";

export function createQrProductionEventId(): string {
  return crypto.randomUUID();
}

export function isQrProductionEventId(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID_PATTERN.test(value);
}

/**
 * Permanently claims this event for the current tab session before any request
 * is sent. Fail closed if storage is unavailable so reloads cannot replay it.
 */
export function claimQrProductionEvent(
  eventId: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
): boolean {
  if (!isQrProductionEventId(eventId)) return false;
  const key = `${ATTEMPT_STORAGE_PREFIX}${eventId}`;
  try {
    const sessionStorage = storage ?? window.sessionStorage;
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "attempted");
    return true;
  } catch {
    return false;
  }
}
