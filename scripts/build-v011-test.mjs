import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(root, 'dist', 'web');
const reportPath = join(root, 'dist', 'v0.11-test-manifest.json');

function run(label, args) {
  console.log(`\n[v0.11] ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function artifactFiles(directory) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await artifactFiles(fullPath));
    else if (entry.isFile()) {
      const body = await readFile(fullPath);
      output.push({
        path: relative(artifactRoot, fullPath).replaceAll('\\', '/'),
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
  }
  return output;
}

const vite = ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts'];

run('Strict frontend typecheck', ['node_modules/typescript/bin/tsc', '--project', 'apps/web/tsconfig.json', '--noEmit']);
run('Frontend foundation tests', ['--test', '--test-isolation=none', 'tests/frontend-foundation.test.mjs']);
run('Frontend production build — pass 1', vite);
const firstBuild = await artifactFiles(artifactRoot);
run('Frontend production build — pass 2', vite);
const secondBuild = await artifactFiles(artifactRoot);
assert.deepEqual(secondBuild, firstBuild, 'two clean Vite builds produced different files');
run('Complete deterministic regression suite', ['--test', 'tests/*.test.mjs']);

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 1,
  version: '0.11.0-test',
  artifactRoot: 'dist/web',
  deterministicBuildPasses: 2,
  files: secondBuild,
}, null, 2)}\n`, 'utf8');

console.log('\n[v0.11] PASS');
console.log(`[v0.11] Runnable artifact: ${artifactRoot}`);
console.log(`[v0.11] Deterministic manifest: ${reportPath}`);
