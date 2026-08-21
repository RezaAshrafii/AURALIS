import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../native/core/src/bin/auralis-audio-test.rs', import.meta.url), 'utf8');
const persistence = await readFile(new URL('../native/core/src/audio/persistence.rs', import.meta.url), 'utf8');
const app = await readFile(new URL('../apps/web/public/app-react.js', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-v014-windows-product-bridge.ps1', import.meta.url), 'utf8');
const gate = await readFile(new URL('../scripts/run-v014-product-bridge-gate.ps1', import.meta.url), 'utf8');

test('native product event is observable only after raw spool and ledger commit', () => {
  const commit = persistence.indexOf('self.ledger.commit_chunk(&finalized, None)?;');
  const notify = persistence.indexOf('self.notify_chunk_committed(&finalized);');
  assert.ok(commit >= 0 && notify > commit);
  assert.ok(persistence.includes('with_chunk_commit_observer'));
  assert.ok(runner.includes('"audio.chunk_closed"'));
  assert.ok(runner.includes('chunk.sha256_hex'));
  assert.ok(runner.includes('event_spool_root.join(&chunk.path)'));
});

test('Rust stdout product protocol is strict session-bound JSONL', () => {
  for (const needle of [
    'auralis.native/jsonl-v1',
    '--event-protocol',
    '--event-session-id',
    'capture.channel_started',
    'probe.heartbeat',
    'capture.channel_stopped'
  ]) assert.ok(runner.includes(needle), needle);
  assert.ok(runner.includes('if event_protocol.is_some() != event_session_id.is_some()'));
  assert.ok(runner.includes('product-events.jsonl'));
  assert.ok(runner.indexOf('journal.sync_data()') < runner.indexOf('let stdout = std::io::stdout();'));
});

test('server does not mark LIVE on process spawn and waits for every requested channel event', () => {
  const start = server.slice(server.indexOf('async function startNativeCapture'), server.indexOf('async function stopNativeCapture'));
  assert.ok(start.includes("nativeCapture.state = 'AWAITING_PROTOCOL'"));
  assert.ok(!start.includes("proc.once('spawn', () => {\n    nativeCapture.state = 'CAPTURING'"));
  assert.ok(start.includes('await waitForNativeProtocol(runId)'));
  assert.ok(start.includes("error:'NATIVE_EVENT_PROTOCOL_TIMEOUT'"));
  assert.ok(server.includes("expected.every(cid => nativeCapture.channels?.[cid]?.state === 'CAPTURING')"));
  assert.ok(app.includes("function isCaptureActive(value){return /CAPTURING|RUNNING/i"));
});

test('durable native chunks are integrity-checked, converted to WAV, and then frozen for ASR', () => {
  const materialize = server.slice(server.indexOf('async function materializeNativeChunkSegment'), server.indexOf('function ingestNativeEvent'));
  assert.ok(materialize.includes('native chunk byte length mismatch'));
  assert.ok(materialize.includes('native chunk SHA-256 mismatch'));
  assert.ok(materialize.includes('materializeAsrWav(raw, payload)'));
  assert.ok(materialize.includes("type:'segment.frozen'"));
  assert.ok(materialize.includes("vad_engine:'native-fixed-window-v0.14.1'"));
  assert.ok(server.includes("import { resolve, join, extname, sep }"));
  assert.ok(server.includes("eventJournals.push(join(sessionDir, runDir.name, 'product-events.jsonl'))"));
});

test('fixed-window fallback is disclosed and neural VAD is not falsely claimed', () => {
  assert.ok(server.includes("return 'FIXED_WINDOW_FALLBACK'"));
  assert.ok(server.includes("'speech-boundary-neural-vad'"));
  assert.ok(server.includes('durable fixed-window fallback'));
});

test('Windows build and hardware gate produce only the explicitly promoted bridge artifact', () => {
  assert.ok(build.includes("dist\\v0.14-windows-product-bridge"));
  assert.ok(build.includes("auralis-audio-bridge.exe"));
  assert.ok(gate.includes("Non-JSON stdout violates jsonl-v1"));
  assert.ok(gate.includes('Get-FileHash'));
  assert.ok(gate.includes('AURALIS_V014_PRODUCT_BRIDGE_GATE_PASS'));
});
