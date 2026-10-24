import express from "express";
import { createServer as createViteServer } from "vite";
import { registerAiLayoutRoute } from "./server/ai-layout-relay.mjs";

const app = express();
const port = Number(process.env.PORT) || 5000;
const upstreamBase = "https://naebangsikqr.replit.app";
const profileTokenPattern = /^[A-Za-z0-9._~+\/=-]{20,128}$/;
const qrProductionAccessToken = process.env.NODE_ENV === "production"
  ? ""
  : process.env.QR_PROFILE_PRODUCTION_ACCESS_TOKEN?.trim() ?? "";

app.disable("x-powered-by");

app.post("/api/qr-profile", express.json({ limit: "8kb" }), async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!profileTokenPattern.test(token)) {
    return res.status(400).json({ error: "사용할 수 없는 QR이에요." });
  }

  try {
    const upstream = await fetch(`${upstreamBase}/api/profiles/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(qrProductionAccessToken
          ? { Authorization: `Bearer ${qrProductionAccessToken}` }
          : {}),
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
      redirect: "manual",
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      return res.status(502).json({ error: "중앙 QR 서비스에 연결할 수 없어요." });
    }

    const body = await upstream.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return res.status(502).json({ error: "중앙 QR 서비스에서 읽을 수 없는 응답을 받았어요." });
    }

    return res.status(upstream.status).json(body);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return res.status(502).json({
      error: timedOut
        ? "중앙 QR 서비스 응답이 늦어요. 잠시 후 다시 시도해 주세요."
        : "중앙 QR 서비스에 연결할 수 없어요. 데모 프로필을 대신 적용할 수 있어요.",
    });
  }
});

registerAiLayoutRoute(app);
if (process.env.NODE_ENV === "development") {
  const { registerUniversalLayoutMockRoute } =
    await import("./server/universal-layout-v1/mock-route.mjs");
  registerUniversalLayoutMockRoute(app);
}

if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist", { maxAge: "1h" }));
  app.get(/.*/, (_req, res) => res.sendFile(new URL("./dist/index.html", import.meta.url).pathname));
} else {
  const vite = await createViteServer({
    configFile: "./vite.config.ts",
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Cafe kiosk demo listening on port ${port}`);
});
