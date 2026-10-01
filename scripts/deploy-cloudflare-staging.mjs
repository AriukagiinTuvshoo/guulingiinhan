import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const stagingApiBase = "https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/api/v1";
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || stagingApiBase;

if (apiBase !== stagingApiBase) {
  console.error("Staging deploy only accepts the configured staging API URL.");
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(scriptDir, "../node_modules/@vinext/cloudflare/dist/cli.js");
const result = spawnSync(process.execPath, [cliPath, "deploy"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: stagingApiBase },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
