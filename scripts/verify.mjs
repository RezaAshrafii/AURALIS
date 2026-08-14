import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'VERSION',
  'package.json',
  'package-lock.json',
  'server.mjs',
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/src/main.ts',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'scripts/build-v011-test.mjs',
  'scripts/run-v011-test.ps1',
  'docs/architecture.md',
  'docs/adr/0001-incremental-source-foundation.md',
  'docs/adr/0003-incremental-vite-bridge.md',
  'docs/tasks/AUR-1101.md',
  'docs/tasks/AUR-1103.md',
  'docs/tasks/AUR-1104.md',
  'docs/V011_TEST_PROCEDURE.md',
  'handoff/AUR-1101.json',
  'handoff/AUR-1104.json',
  'handoff/v0.11.0.json',
];

async function verifyFiles() {
  for (const file of requiredFiles) await access(file);

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const handoff = JSON.parse(await readFile('handoff/AUR-1101.json', 'utf8'));
  if (packageJson.scripts?.test !== 'node --test "tests/*.test.mjs"') {
    throw new Error('package.json test script does not match the repository test command');
  }
  if (packageJson.scripts?.verify !== 'node scripts/verify.mjs') {
    throw new Error('package.json verify script does not point to scripts/verify.mjs');
  }
  if (handoff.task !== 'AUR-1101') throw new Error('handoff task identifier is invalid');
}

function run(label, command, args) {
  console.log(`\n[verify] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  await verifyFiles();
  console.log('[verify] Foundation files and JSON: PASS');
  run('Server syntax', process.execPath, ['--check', 'server.mjs']);
  run('Application syntax', process.execPath, ['--check', 'app/app-react.js']);
  run('UI kit syntax', process.execPath, ['--check', 'app/ui-kit.js']);
  run('Frontend typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'apps/web/tsconfig.json', '--noEmit']);
  run('Frontend tests', process.execPath, ['--test', 'tests/frontend-foundation.test.mjs']);
  run('Frontend build', process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/web/vite.config.ts']);
  run('Contract and regression tests', process.execPath, ['--test', 'tests/*.test.mjs']);
  console.log('\n[verify] PASS');
} catch (error) {
  console.error(`[verify] FAIL: ${error.message}`);
  process.exit(1);
}
