import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v0.11 version metadata is synchronized without changing the CURRENT route surface', async () => {
  const [version, rootPackage, webPackage, contractsPackage, appVersion, server, sourceHtml, viteHtml, currentContract] = await Promise.all([
    read('VERSION'),
    read('package.json'),
    read('apps/web/package.json'),
    read('packages/contracts/package.json'),
    read('app/version.json'),
    read('server.mjs'),
    read('app/index.html'),
    read('apps/web/index.html'),
    read('packages/contracts/current.mjs'),
  ]);

  assert.equal(version.trim(), '0.11.0');
  assert.equal(JSON.parse(rootPackage).version, '0.11.0');
  assert.equal(JSON.parse(webPackage).version, '0.11.0');
  assert.equal(JSON.parse(contractsPackage).version, '0.11.0');
  assert.equal(JSON.parse(appVersion).version, '0.11.0');
  assert.match(server, /const VERSION = '0\.11\.0-engineering-foundation\.1'/);
  assert.match(sourceHtml, /Auralis v0\.11\.0/);
  assert.match(viteHtml, /Auralis v0\.11\.0/);
  assert.match(currentContract, /applicationVersion: '0\.11\.0'/);
});

test('v0.11 artifact builder proves two identical builds before reporting PASS', async () => {
  const [rootPackage, builder] = await Promise.all([
    read('package.json'),
    read('scripts/build-v011-test.mjs'),
  ]);

  assert.equal(JSON.parse(rootPackage).scripts['build:v0.11:test'], 'node scripts/build-v011-test.mjs');
  assert.match(builder, /Frontend production build — pass 1/);
  assert.match(builder, /Frontend production build — pass 2/);
  assert.match(builder, /assert\.deepEqual\(secondBuild, firstBuild/);
  assert.match(builder, /createHash\('sha256'\)/);
  assert.match(builder, /Complete deterministic regression suite/);
  assert.match(builder, /dist', 'v0\.11-test-manifest\.json/);
});

test('v0.11 launcher serves only the generated artifact through the existing local API', async () => {
  const [launcher, procedure] = await Promise.all([
    read('scripts/run-v011-test.ps1'),
    read('docs/V011_TEST_PROCEDURE.md'),
  ]);

  assert.match(launcher, /AURALIS_USE_VITE_BUILD = '1'/);
  assert.match(launcher, /dist\\web\\index\.html/);
  assert.match(launcher, /BunPath must point to the trusted Windows bun\.exe runtime/);
  assert.match(procedure, /npm ci --ignore-scripts/);
  assert.match(procedure, /npm run build:v0\.11:test/);
  assert.match(procedure, /scripts\\run-v011-test\.ps1/);
  assert.match(procedure, /not REAL_WINDOWS_HARDWARE validation/i);
});
