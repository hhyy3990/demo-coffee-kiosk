import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = resolve(packageRoot, "test/consumer-fixture");
const tarball = resolve(packageRoot, "releases/naebangsik-kiosk-accessibility-sdk-0.1.0.tgz");
const consumerRoot = await mkdtemp(join(tmpdir(), "kiosk-sdk-consumer-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

try {
  await cp(fixtureRoot, consumerRoot, { recursive: true });
  run(
    "npm",
    ["install", "--prefix", consumerRoot, "--no-audit", "--no-fund", tarball],
    repositoryRoot,
  );
  run(
    resolve(repositoryRoot, "node_modules/.bin/tsc"),
    ["--project", resolve(consumerRoot, "tsconfig.json")],
    repositoryRoot,
  );
  run(
    resolve(repositoryRoot, "node_modules/.bin/vite"),
    ["build", consumerRoot, "--outDir", resolve(consumerRoot, "build")],
    repositoryRoot,
  );
  console.log("Standalone tarball install, declaration typecheck, and consumer production build passed.");
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
}
