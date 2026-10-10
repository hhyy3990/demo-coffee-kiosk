import { validateAccessibilityProfile, type AccessibilityProfile } from "./profile.ts";

export const CENTRAL_QR_ORIGIN = "https://naebangsikqr.replit.app";
const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/=-]{1,512}$/;
const PROFILE_ENDPOINT = "/api/qr-profile";

export function isValidProfileToken(value: string): boolean {
  return value.trim() === value && TOKEN_PATTERN.test(value);
}

function tokenFromOfficialUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== CENTRAL_QR_ORIGIN || url.username || url.password) return "";
    const values = url.searchParams.getAll("token");
    return values.length === 1 && isValidProfileToken(values[0]) ? values[0] : "";
  } catch {
    return "";
  }
}

export function getScannedProfileToken(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 2048 ? tokenFromOfficialUrl(trimmed) : "";
}

export function getManualProfileToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return "";
  if (/^(https?:\/\/|\/\/|\/|\?|www\.)/i.test(trimmed) || /^[\w.-]+\.[a-z]{2,}(?:\/|[?#]|$)/i.test(trimmed)) {
    if (trimmed.startsWith("//") || trimmed.startsWith("/") || trimmed.startsWith("?")) return "";
    return tokenFromOfficialUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  }
  return isValidProfileToken(trimmed) ? trimmed : "";
}

function unavailable(body: unknown): boolean {
  if (!body || typeof body !== "object") return true;
  const record = body as Record<string, unknown>;
  const candidates = [record, record.profile, record.data].filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object",
  );
  const inactive = new Set(["disabled", "inactive", "deactivated", "revoked", "expired", "deleted", "unavailable"]);
  return candidates.some((item) =>
    item.success === false || item.ok === false || item.active === false || item.enabled === false ||
    item.isActive === false || item.isEnabled === false || item.disabled === true || item.revoked === true ||
    (typeof item.status === "string" && inactive.has(item.status.toLowerCase())),
  );
}

export interface QrProfileClient {
  resolve(value: string, inputKind?: "scan" | "manual"): Promise<AccessibilityProfile>;
  cancel(): void;
  readonly loading: boolean;
}

export function createQrProfileClient(options: { fetcher?: typeof fetch } = {}): QrProfileClient {
  const fetcher = options.fetcher ?? fetch;
  let controller: AbortController | null = null;
  return {
    get loading() { return controller !== null; },
    cancel() { controller?.abort(); controller = null; },
    async resolve(value, inputKind = "manual") {
      if (controller) throw new Error("PROFILE_REQUEST_IN_PROGRESS");
      const token = inputKind === "scan" ? getScannedProfileToken(value) : getManualProfileToken(value);
      if (!token) throw new Error("QR_UNAVAILABLE");
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetcher(PROFILE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal: request.signal,
        });
        if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const body: unknown = await response.json().catch(() => null);
        if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (!response.ok) {
          if ([400, 401, 403, 404, 410, 422].includes(response.status)) throw new Error("QR_UNAVAILABLE");
          throw new Error("PROFILE_LOOKUP_FAILED");
        }
        if (unavailable(body)) throw new Error("QR_UNAVAILABLE");
        if (!body || typeof body !== "object") throw new Error("QR_UNAVAILABLE");
        const record = body as Record<string, unknown>;
        const profile = record.preferences ??
          (record.profile && typeof record.profile === "object" ? (record.profile as Record<string, unknown>).preferences : undefined) ??
          (record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>).preferences : undefined);
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("QR_UNAVAILABLE");
        return validateAccessibilityProfile(profile);
      } finally {
        if (controller === request) controller = null;
      }
    },
  };
}
