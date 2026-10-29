import express from "express";
import { createServer as createViteServer } from "vite";
import { registerAiLayoutRoute } from "./server/ai-layout-relay.mjs";
import { registerQrProfileRoute } from "./server/qr-profile-route.mjs";

const app = express();
const port = Number(process.env.PORT) || 5000;

app.disable("x-powered-by");

registerQrProfileRoute(app);

registerAiLayoutRoute(app);
if (process.env.NODE_ENV === "development") {
  const { registerUniversalLayoutMockRoute } =
    await import("./server/universal-layout-v1/mock-route.mjs");
  const { registerUniversalLayoutRelayRoute } =
    await import("./server/universal-layout-v1/relay-route.mjs");
  const { registerUniversalLayoutV2MockRoute } =
    await import("./server/universal-layout-v2/mock-route.mjs");
  const { registerUniversalLayoutV2RelayRoute } =
    await import("./server/universal-layout-v2/relay-route.mjs");
  registerUniversalLayoutMockRoute(app);
  registerUniversalLayoutRelayRoute(app);
  registerUniversalLayoutRelayRoute(app, { mode: "openai" });
  registerUniversalLayoutV2MockRoute(app);
  registerUniversalLayoutV2RelayRoute(app);
  registerUniversalLayoutV2RelayRoute(app, { mode: "openai" });
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
