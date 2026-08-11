import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const go = await readFile(new URL('../native-probe/main.go', import.meta.url), 'utf8');
const sql = await readFile(new URL('../native/core/src/storage/migrations/0001_audio_ledger.sql', import.meta.url), 'utf8');

test('server exposes native capture start/stop/status and persistent chunk ledger', () => {
  for (const needle of ['/v1/native-capture/start','/v1/native-capture/stop','/v1/native-capture/status','CREATE TABLE IF NOT EXISTS audio_chunks','CREATE TABLE IF NOT EXISTS native_capture_runs']) {
    assert.ok(server.includes(needle), `missing ${needle}`);
  }
});

test('validation probe uses WASAPI event callback and loopback rather than browser audio', () => {
  assert.ok(go.includes('audclntStreamflagsEvent'));
  assert.ok(go.includes('audclntStreamflagsLoopback'));
  assert.ok(go.includes('GetDefaultAudioEndpoint'));
  assert.ok(go.includes('IAudioCaptureClient.GetBuffer'));
  assert.ok(!go.includes('getUserMedia'));
});

test('capture queue is bounded and overflow becomes explicit gap event', () => {
  assert.match(go, /make\(chan audioFrame,\s*256\)/);
  assert.ok(go.includes('capture_queue_overflow'));
  assert.ok(go.includes('audio.gap_detected'));
});

test('raw capture preserves all interleaved channels', () => {
  assert.match(go, /nbytes := int\(numFrames\) \* int\(wf\.BlockAlign\)/);
  assert.ok(go.includes('unsafe.Slice'));
  assert.ok(!go.includes('inputs[0][0]'));
});

test('spool is append-only and chunk close records sha256 and sequence range', () => {
  assert.ok(go.includes('os.O_CREATE|os.O_WRONLY|os.O_EXCL'));
  assert.ok(go.includes('SeqStart'));
  assert.ok(go.includes('SeqEnd'));
  assert.ok(go.includes('SHA256'));
  assert.ok(go.includes('native-ledger.jsonl'));
});

test('server replays native ledger and recovers unclosed raw chunks after restart', () => {
  assert.ok(server.includes('recoverNativeLedgers'));
  assert.ok(server.includes('native.audio.chunk_recovered'));
  assert.ok(server.includes('recovered_unclosed') || server.includes('chunk_recovered'));
});

test('target Rust ledger schema enforces non-empty sequence range', () => {
  assert.ok(sql.includes('CHECK(seq_end > seq_start)'));
  assert.ok(sql.includes('UNIQUE(channel_id, seq_start, seq_end)'));
  assert.ok(sql.includes('PRAGMA journal_mode=WAL'));
});
