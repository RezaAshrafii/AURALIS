import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalRequestGuard, HttpInputError, readJsonBody, resolveStaticPath } from '../runtime/http-boundary.mjs';
import { loadRuntimeConfig } from '../runtime/config.mjs';
import { createTaskSupervisor } from '../runtime/task-supervisor.mjs';

test('runtime config is version-owned, loopback-only, and validates the port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auralis-config-'));
  await writeFile(join(root, 'VERSION'), '0.13.0\n');
  const config = await loadRuntimeConfig(root, { AURALIS_PORT: '48000' });
  assert.equal(config.version, '0.13.0');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 48000);
  const testConfig = await loadRuntimeConfig(root, { NODE_ENV:'test', AURALIS_TEST_PROVIDER_URL:'http://127.0.0.1:47999/v1/chat/completions' });
  assert.equal(testConfig.providerUrl, 'http://127.0.0.1:47999/v1/chat/completions');
  await assert.rejects(() => loadRuntimeConfig(root, { AURALIS_PORT: '80' }), /AURALIS_PORT/);
  await assert.rejects(() => loadRuntimeConfig(root, { NODE_ENV:'test', AURALIS_TEST_PROVIDER_URL:'http://example.com/' }), /loopback/);
});

test('local request guard rejects cross-site bootstrap and uses authenticated state changes', () => {
  const guard = createLocalRequestGuard({ host: '127.0.0.1', port: 47832, token: 'a'.repeat(64) });
  const local = new Request('http://127.0.0.1:47832/v1/bootstrap', { headers: { host: '127.0.0.1:47832' } });
  const crossSite = new Request('http://127.0.0.1:47832/v1/bootstrap', {
    headers: { host: '127.0.0.1:47832', origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' }
  });
  const authed = new Request('http://127.0.0.1:47832/v1/sessions', {
    method: 'POST',
    headers: { host: '127.0.0.1:47832', origin: 'http://127.0.0.1:47832', 'x-auralis-token': 'a'.repeat(64) }
  });
  assert.equal(guard.bootstrapAllowed(local), true);
  assert.equal(guard.bootstrapAllowed(crossSite), false);
  assert.equal(guard.stateChangeAllowed(authed), true);
});

test('JSON boundary rejects malformed, non-object, and oversized bodies', async () => {
  await assert.rejects(
    () => readJsonBody(new Request('http://local', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })),
    error => error instanceof HttpInputError && error.code === 'INVALID_JSON'
  );
  await assert.rejects(
    () => readJsonBody(new Request('http://local', { method: 'POST', body: '[]', headers: { 'content-type': 'application/json' } })),
    error => error instanceof HttpInputError && error.code === 'INVALID_JSON_OBJECT'
  );
  await assert.rejects(
    () => readJsonBody(new Request('http://local', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(32) }), headers: { 'content-type': 'application/json' } }), 16),
    error => error instanceof HttpInputError && error.code === 'BODY_TOO_LARGE'
  );
});

test('static path boundary rejects traversal and malformed encoding', () => {
  const root = join(tmpdir(), 'auralis-static');
  assert.equal(resolveStaticPath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveStaticPath(root, '/../secret'), null);
  assert.throws(() => resolveStaticPath(root, '/%E0%A4%A'), /Malformed URL path encoding/);
});

test('task supervisor drains accepted background work and records failures', async () => {
  const errors = [];
  const supervisor = createTaskSupervisor({ onError: (error, label) => errors.push([label, error.message]) });
  supervisor.run('failure', async () => { throw new Error('boom'); });
  assert.equal(await supervisor.stop(), true);
  assert.deepEqual(errors, [['failure', 'boom']]);
  assert.equal(supervisor.run('late', async () => {}), false);
});
