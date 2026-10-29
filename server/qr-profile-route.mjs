import express from "express";

const CENTRAL_QR_RESOLVE_URL = "https://naebangsikqr.replit.app/api/profiles/resolve";
const PROFILE_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/=-]{20,128}$/;
const UPSTREAM_TIMEOUT_MS = 12_000;

function normalizedContentType(response) {
  const value = response.headers.get("content-type");
  if (typeof value !== "string") return null;
  const mimeType = value.split(";", 1)[0].trim().toLowerCase();
  return mimeType || null;
}

function isJsonContentType(contentType) {
  return contentType === "application/json" ||
    (contentType?.startsWith("application/") === true && contentType.endsWith("+json"));
}

function publicFailure(res) {
  return res.status(502).json({ error: "중앙 QR 서비스에 연결할 수 없어요." });
}

export function registerQrProfileRoute(app, {
  env = process.env,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  app.post("/api/qr-profile", express.json({ limit: "8kb" }), async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!PROFILE_TOKEN_PATTERN.test(token)) {
      return res.status(400).json({ error: "사용할 수 없는 QR이에요." });
    }

    const externalAccessToken = env.QR_PROFILE_PRODUCTION_ACCESS_TOKEN?.trim() ?? "";
    if (!externalAccessToken) {
      return res.status(503).json({ error: "중앙 QR 서비스에 연결할 수 없어요." });
    }

    try {
      const upstream = await fetchImpl(CENTRAL_QR_RESOLVE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${externalAccessToken}`,
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: "no-store",
        redirect: "manual",
      });
      const contentType = normalizedContentType(upstream);
      logger.info?.("[qr-profile upstream]", {
        status: upstream.status,
        contentType,
      });

      if (upstream.status >= 300 && upstream.status < 400) return publicFailure(res);
      if (upstream.status === 401 || upstream.status === 403) return publicFailure(res);

      if (upstream.status === 404) {
        if (!isJsonContentType(contentType)) return publicFailure(res);
        return res.status(404).json({ error: "사용할 수 없는 QR이에요." });
      }

      if (upstream.status !== 200 || !isJsonContentType(contentType)) {
        return publicFailure(res);
      }

      const body = await upstream.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return publicFailure(res);
      }

      return res.status(200).json(body);
    } catch {
      return publicFailure(res);
    }
  });
}
