import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('frontend workspace pins the minimal React TypeScript Vite toolchain', async () => {
  const root = JSON.parse(await read('package.json'));
  const web = JSON.parse(await read('apps/web/package.json'));

  assert.ok(root.workspaces.includes('apps/*'));
  assert.equal(root.scripts['frontend:typecheck'], 'tsc --project apps/web/tsconfig.json --noEmit');
  assert.equal(root.scripts['frontend:test'], 'node --test --test-isolation=none "tests/frontend-foundation.test.mjs"');
  assert.equal(root.scripts['frontend:build'], 'vite build --config apps/web/vite.config.ts');
  assert.deepEqual(web.dependencies, { react: '18.3.1', 'react-dom': '18.3.1' });
  assert.deepEqual(Object.keys(web.devDependencies).sort(), ['@types/react', '@types/react-dom', 'typescript', 'vite']);
  for (const version of Object.values({ ...web.dependencies, ...web.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `dependency must be exactly pinned: ${version}`);
  }
});

test('typed bootstrap reuses the shipped UI instead of copying or redesigning it', async () => {
  const [entry, index, config] = await Promise.all([
    read('apps/web/src/main.ts'),
    read('apps/web/index.html'),
    read('apps/web/vite.config.ts'),
  ]);

  assert.match(entry, /import \* as React from 'react'/);
  assert.match(entry, /import \{ createRoot \} from 'react-dom\/client'/);
  assert.match(entry, /import '\.\.\/\.\.\/\.\.\/app\/styles\.css'/);
  assert.match(entry, /await import\('\.\.\/\.\.\/\.\.\/app\/ui-kit\.js'\)/);
  assert.match(entry, /await import\('\.\.\/\.\.\/\.\.\/app\/app-react\.js'\)/);
  assert.doesNotMatch(entry, /@ts-(?:no)?check/);
  assert.match(index, /<html lang="fa" dir="rtl" data-theme="dark">/);
  assert.match(index, /<script type="module" src="\/src\/main\.ts"><\/script>/);
  assert.match(config, /base: '\.\/'/);
  assert.match(config, /\.\.\/\.\.\/dist\/web/);
});

test('TypeScript foundation keeps CURRENT transport and routes unchanged', async () => {
  const [entry, currentContract, server] = await Promise.all([
    read('apps/web/src/main.ts'),
    read('packages/contracts/current.mjs'),
    read('server.mjs'),
  ]);

  assert.doesNotMatch(entry, /WebSocket|EventSource|\/v1\//);
  assert.match(currentContract, /transport: 'HTTP polling'/);
  assert.match(currentContract, /websocket: false/);
  assert.match(currentContract, /server: 'server\.mjs'/);
  assert.match(server, /AURALIS_USE_VITE_BUILD === '1' \? join\(ROOT, 'dist', 'web'\) : SOURCE_APP/);
  assert.match(server, /if \(process\.env\.AURALIS_NO_BROWSER !== '1'\) setTimeout\(openBrowser, 180\)/);
});
