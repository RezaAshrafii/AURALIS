import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

test('v0.12 hardware-gate binary cannot silently replace the working product capture path',()=>{
  assert.ok(server.includes("AURALIS_EXPERIMENTAL_V012_CAPTURE === '1'"));
  const fn=server.slice(server.indexOf('async function nativeExecutable()'),server.indexOf('async function startNativeCapture'));
  assert.ok(fn.indexOf('ENABLE_EXPERIMENTAL_V012_PRODUCT_CAPTURE') < fn.indexOf('V012_NATIVE_CANDIDATES'));
  assert.ok(fn.includes('LEGACY_NATIVE_PROBE'));
});

test('source foundation scripts referenced by package.json exist as real first-class commands',()=>{
  assert.equal(pkg.version,'0.12.0');
  assert.equal(pkg.scripts.verify,'node scripts/verify.mjs');
  assert.equal(pkg.scripts['frontend:typecheck'],'tsc --project apps/web/tsconfig.json --noEmit');
});
