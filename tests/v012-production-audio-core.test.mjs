import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cargo=await readFile(new URL('../native/core/Cargo.toml',import.meta.url),'utf8');
const wasapi=await readFile(new URL('../native/core/src/audio/wasapi.rs',import.meta.url),'utf8');
const handoff=await readFile(new URL('../native/core/src/audio/handoff.rs',import.meta.url),'utf8');
const audioMod=await readFile(new URL('../native/core/src/audio/mod.rs',import.meta.url),'utf8');
const spool=await readFile(new URL('../native/core/src/audio/spool.rs',import.meta.url),'utf8');
const repository=await readFile(new URL('../native/core/src/storage/repository.rs',import.meta.url),'utf8');
const runner=await readFile(new URL('../native/core/src/bin/auralis-audio-test.rs',import.meta.url),'utf8');
const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const runtimeConfig=await readFile(new URL('../runtime/config.mjs',import.meta.url),'utf8');
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const version=(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
const gate=await readFile(new URL('../scripts/run-v012-gate-suite.ps1',import.meta.url),'utf8');
const verifier=await readFile(new URL('../scripts/verify-v012-capture-summary.ps1',import.meta.url),'utf8');
const buildScript=await readFile(new URL('../scripts/build-v012-windows-test.ps1',import.meta.url),'utf8');

test('v0.12 production audio foundation remains intact in the v0.16 release',()=>{
  assert.equal(version,'0.16.0');
  assert.equal(pkg.version,'0.16.0');
  assert.match(cargo,/version = "0\.16\.0"/);
  assert.ok(server.includes("PERSONAL_MEMORY_ENGINE_CANDIDATE"));
});

test('Rust core uses direct Windows WASAPI and event-driven capture',()=>{
  assert.ok(cargo.includes('Win32_Media_Audio'));
  assert.ok(wasapi.includes('AUDCLNT_STREAMFLAGS_EVENTCALLBACK'));
  assert.ok(wasapi.includes('AUDCLNT_STREAMFLAGS_LOOPBACK'));
  assert.ok(wasapi.includes('SetEventHandle'));
  assert.ok(wasapi.includes('GetBuffer'));
});

test('capture handoff is bounded and tracks dropped buffers and samples',()=>{
  assert.ok(audioMod.includes('DEFAULT_CAPTURE_QUEUE_CAPACITY: usize = 256'));
  assert.ok(handoff.includes('dropped_buffers'));
  assert.ok(handoff.includes('dropped_samples'));
  assert.ok(handoff.includes('try_submit'));
});

test('raw spool is append-only and records durable integrity metadata',()=>{
  assert.ok(spool.includes('create_new(true)'));
  assert.ok(spool.includes('Sha256'));
  assert.ok(spool.includes('sequence_start'));
  assert.ok(spool.includes('sequence_end'));
});

test('SQLite ledger enables WAL and persists explicit gap/lifecycle state',()=>{
  assert.ok(repository.includes('PRAGMA journal_mode=WAL'));
  assert.ok(repository.includes('record_gap'));
  assert.ok(repository.includes('record_lifecycle'));
  assert.ok(repository.includes('channel_resume_cursor'));
});

test('hardware runner reports queue loss, unknown gaps and durable channels',()=>{
  for(const needle of ['unknown_gap_count','durable_sequence','dropped_buffers','dropped_samples','capture-summary.json','--stop-file']){
    assert.ok(runner.includes(needle),needle);
  }
});

test('real Windows hardware suite checks mic loopback both and 20-minute soak',()=>{
  assert.ok(gate.includes("Run-Gate mic 60 '01-mic'"));
  assert.ok(gate.includes("Run-Gate loopback 60 '02-loopback'"));
  assert.ok(gate.includes("Run-Gate both 120 '03-both'"));
  assert.ok(gate.includes("Run-Gate both 1200 '04-both-20m'"));
});

test('capture summary verifier rejects unknown gaps and queue loss',()=>{
  assert.ok(verifier.includes('unknown_gap_count'));
  assert.ok(verifier.includes('dropped_buffers'));
  assert.ok(verifier.includes('dropped_samples'));
  assert.ok(verifier.includes('GATE_RESULT=FAIL'));
  assert.ok(verifier.includes('GATE_RESULT=PASS'));
});

test('packaged v0.14 product bridge is default while hardware-only v0.13 artifacts remain gated',()=>{
  assert.ok(runtimeConfig.includes("AURALIS_EXPERIMENTAL_V013_CAPTURE === '1'"));
  const start=server.indexOf('async function nativeExecutable()');
  const end=server.indexOf('async function startNativeCapture',start);
  const block=server.slice(start,end);
  assert.ok(block.indexOf('V014_NATIVE_CANDIDATES') < block.indexOf('ENABLE_EXPERIMENTAL_V013_PRODUCT_CAPTURE'));
  assert.ok(block.includes('ENABLE_EXPERIMENTAL_V013_PRODUCT_CAPTURE'));
  assert.ok(block.includes('LEGACY_NATIVE_PROBE'));
});

test('Windows Rust build script has no user-specific hard-coded Cargo path',()=>{
  assert.ok(!buildScript.includes('C:\\Users\\Reza'));
  assert.ok(buildScript.includes('Get-Command cargo'));
});
