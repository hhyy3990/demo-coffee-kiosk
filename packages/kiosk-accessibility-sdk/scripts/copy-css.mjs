import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(packageRoot, "dist"), { recursive: true });
await copyFile(
  resolve(packageRoot, "src/styles.css"),
  resolve(packageRoot, "dist/styles.css"),
);
