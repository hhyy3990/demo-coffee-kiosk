export const CENTRAL_QR_ORIGIN = "https://naebangsikqr.replit.app";

const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/=-]{1,512}$/;

export function isValidProfileToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

function extractOfficialUrlToken(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== CENTRAL_QR_ORIGIN ||
      url.username ||
      url.password
    ) {
      return "";
    }

    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1) return "";
    const token = tokens[0].trim();
    return isValidProfileToken(token) ? token : "";
  } catch {
    return "";
  }
}

export function getScannedProfileToken(value: string): string {
  const scannedValue = value.trim();
  if (!scannedValue || scannedValue.length > 2048) return "";
  return extractOfficialUrlToken(scannedValue);
}

export function getManualProfileToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return "";

  const looksLikeUrl =
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("?") ||
    /^www\./i.test(trimmed) ||
    /^[\w.-]+\.[a-z]{2,}(?:\/|[?#]|$)/i.test(trimmed);

  if (looksLikeUrl) {
    if (trimmed.startsWith("//") || trimmed.startsWith("/") || trimmed.startsWith("?")) return "";
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return extractOfficialUrlToken(candidate);
  }

  return isValidProfileToken(trimmed) ? trimmed : "";
}
