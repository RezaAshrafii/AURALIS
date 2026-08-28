import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TSC = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
const required = [
  "server.mjs",
  "VERSION",
  "core/persian-router.mjs",
  "core/answer-schema.mjs",
  "core/turn-policy.mjs",
  "core/speech-engine.mjs",
  "core/vad-state.mjs",
  "core/turn-intelligence.mjs",
  "core/rag-engine.mjs",
  "core/citation-integrity.mjs",
  "core/citation-benchmark.mjs",
  "core/audio-segment-bridge.mjs",
  "test-data/V014_CITATION_BENCHMARK.json",
  "scripts/run-v014-benchmarks.mjs",
  "README-V014.txt",
  "Auralis_v0.14.0_RELEASE_GATES.md",
  "Auralis_v0.14.0_TEST_PLAN_FA.md",
  "Auralis_v0.14.1_RELEASE_EVIDENCE_FA.md",
  "RUN-V014-QUICK-GATE.cmd",
  "scripts/run-v014-intelligence-gate.ps1",
  "runtime/config.mjs",
  "runtime/http-boundary.mjs",
  "runtime/task-supervisor.mjs",
  "apps/web/public/app-react.js",
  "apps/web/public/styles.css",
  "apps/web/tsconfig.json",
  "packages/contracts/src/index.ts",
  "native/core/src/audio/wasapi.rs",
  "native/core/src/audio/spool.rs",
  "native/core/src/audio/recovery.rs",
  "native/core/src/asr/mod.rs",
  "native/core/src/vad/mod.rs",
  "native/core/src/storage/migrations/0006_speech_engine.sql",
  "BUILD-V014-PRODUCT-BRIDGE.cmd",
  "RUN-V014-PRODUCT-BRIDGE-GATE.cmd",
  "V014_WINDOWS_PRODUCT_BRIDGE_GATE.md",
  "scripts/build-v014-windows-product-bridge.ps1",
  "scripts/run-v014-product-bridge-gate.ps1",
  "docs/execution-prompts/00_AURALIS_MASTER_ARCHITECTURE_AND_EXECUTION_CONTRACT_FA.md",
  "docs/execution-prompts/AURALIS_PRODUCT_ROADMAP_ARCHITECT_INDEX_FA.md",
  "docs/execution-prompts/v0.15.0_PRODUCT_EXPERIENCE_IMPLEMENTATION_PROMPT_FA.md",
  "docs/execution-prompts/v0.16.0_PERSONAL_MEMORY_ENGINE_IMPLEMENTATION_PROMPT_FA.md",
  "docs/execution-prompts/v0.17.0_DOMAIN_PRODUCT_LAYER_IMPLEMENTATION_PROMPT_FA.md",
  "docs/execution-prompts/v0.18.0_MOBILE_CLOUD_PLATFORM_IMPLEMENTATION_PROMPT_FA.md",
  "docs/execution-prompts/v0.19.0_MONETIZATION_BETA_IMPLEMENTATION_PROMPT_FA.md",
  "docs/execution-prompts/v1.0.0_COMMERCIAL_RELEASE_IMPLEMENTATION_PROMPT_FA.md",
  "node_modules/.bin/tsc",
];
for (const f of required) await access(join(ROOT, f));
const version = (await readFile(join(ROOT, "VERSION"), "utf8")).trim();
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const webPkg = JSON.parse(await readFile(join(ROOT, "apps/web/package.json"), "utf8"));
const contractsPkg = JSON.parse(
  await readFile(join(ROOT, "packages/contracts/package.json"), "utf8")
);
const webVersion = JSON.parse(await readFile(join(ROOT, "apps/web/public/version.json"), "utf8"));
const cargo = await readFile(join(ROOT, "native/core/Cargo.toml"), "utf8");
for (const [owner, declared] of [
  ["package.json", pkg.version],
  ["apps/web/package.json", webPkg.version],
  ["packages/contracts/package.json", contractsPkg.version],
  ["apps/web/public/version.json", webVersion.version],
]) {
  if (declared !== version) throw new Error(`VERSION/${owner} mismatch: ${version} vs ${declared}`);
}
if (!new RegExp(`^version = "${version.replaceAll(".", "\\.")}"$`, "m").test(cargo))
  throw new Error("VERSION/native/core/Cargo.toml mismatch");
const server = await readFile(join(ROOT, "server.mjs"), "utf8");
if (!server.includes("const VERSION = runtimeConfig.version"))
  throw new Error("server must load VERSION through runtime config");
const commands = [
  ["node", ["--check", "server.mjs"]],
  ["node", ["--check", "apps/web/public/app-react.js"]],
  ["node", ["--check", "apps/web/public/ui-kit.js"]],
  ["node", ["--check", "core/speech-engine.mjs"]],
  ["node", ["--check", "core/vad-state.mjs"]],
  ["node", ["--check", "core/audio-segment-bridge.mjs"]],
  ["node", ["--test", "tests/*.test.mjs"]],
  ["node", ["scripts/run-v014-benchmarks.mjs"]],
  [TSC, ["--project", "apps/web/tsconfig.json", "--noEmit"]],
  ["node", ["scripts/build-web.mjs"]],
];
for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("AURALIS_VERIFY_PASS");
