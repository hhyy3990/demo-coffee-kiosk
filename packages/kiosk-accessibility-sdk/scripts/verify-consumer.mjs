import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = resolve(packageRoot, "test/consumer-fixture");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const tarball = process.env.KIOSK_SDK_TARBALL
  ? resolve(process.env.KIOSK_SDK_TARBALL)
  : resolve(packageRoot, `releases/naebangsik-kiosk-accessibility-sdk-${packageJson.version}.tgz`);
const consumerRoot = await mkdtemp(join(tmpdir(), "kiosk-sdk-consumer-"));

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
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
  const installedPackage = JSON.parse(await readFile(
    resolve(consumerRoot, "node_modules/@naebangsik/kiosk-accessibility-sdk/package.json"),
    "utf8",
  ));
  if (installedPackage.name !== packageJson.name || installedPackage.version !== packageJson.version) {
    throw new Error(`Unexpected installed SDK package: ${installedPackage.name}@${installedPackage.version}`);
  }
  run(
    resolve(repositoryRoot, "node_modules/.bin/tsc"),
    ["--project", resolve(consumerRoot, "tsconfig.json")],
    repositoryRoot,
  );
  run(process.execPath, [
    "--test",
    ...["completion", "diagnostics", "guide", "lifecycle", "profile", "qr-profile", "qr-scanner"]
      .map((name) => resolve(packageRoot, `test/${name}.test.mjs`)),
  ], repositoryRoot, { KIOSK_SDK_CONSUMER_ROOT: consumerRoot });
  run(
    resolve(repositoryRoot, "node_modules/.bin/vite"),
    ["build", consumerRoot, "--outDir", resolve(consumerRoot, "build")],
    repositoryRoot,
  );
  run(
    process.execPath,
    [resolve(packageRoot, "scripts/test-consumer-qr-entry-browser.mjs")],
    repositoryRoot,
    { KIOSK_SDK_CONSUMER_ROOT: consumerRoot },
  );
  console.log("Standalone tarball install, SDK consumer tests, declaration typecheck, and production build passed.");
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
}
