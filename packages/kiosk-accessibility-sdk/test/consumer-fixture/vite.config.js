import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default {
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        qrEntry: resolve(root, "qr-entry.html"),
      },
    },
  },
};
