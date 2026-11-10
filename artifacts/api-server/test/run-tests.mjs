import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const testFile = resolve(packageDir, "test/provider-adapters.test.mjs");
const esbuild = resolve(packageDir, "node_modules/.bin/esbuild");
const bundle = join(tmpdir(), `ai-video-studio-provider-tests-${randomUUID()}.mjs`);
let exitCode = 1;

try {
  const build = spawnSync(esbuild, [
    testFile,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${bundle}`,
  ], { cwd: packageDir, stdio: "inherit" });
  if (build.status === 0) {
    const result = spawnSync(process.execPath, ["--test", bundle], {
      cwd: packageDir,
      stdio: "inherit",
    });
    exitCode = result.status ?? 1;
  } else {
    exitCode = build.status ?? 1;
  }
} finally {
  await rm(bundle, { force: true });
}

process.exitCode = exitCode;
