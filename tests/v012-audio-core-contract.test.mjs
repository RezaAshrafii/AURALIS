import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v0.12 audio domain exposes the required source-of-truth entities', async () => {
  const [ledger, frame] = await Promise.all([
    read('native/core/src/domain/ledger.rs'),
    read('native/core/src/domain/audio_frame.rs'),
  ]);

  for (const entity of [
    'Session',
    'AudioChannel',
    'AudioChunk',
    'Gap',
    'CaptureState',
    'DeviceState',
    'RecoveryState',
  ]) {
    assert.match(ledger, new RegExp(`(?:struct|enum) ${entity}\\b`));
  }
  for (const field of [
    'source_kind',
    'sample_rate_hz',
    'channels',
    'channel_mask',
    'sample_format',
    'sequence_start',
    'qpc_start_100ns',
    'device_position',
  ]) {
    assert.match(frame, new RegExp(`pub ${field}:`));
  }
});

test('capture handoff and spool contracts are non-blocking and persistence-owned', async () => {
  const ports = await read('native/core/src/domain/ports.rs');

  assert.match(ports, /trait CaptureHandoffPort/);
  assert.match(ports, /fn try_submit\(/);
  assert.match(ports, /CaptureHandoffError/);
  assert.match(ports, /trait AudioSpoolPort/);
  assert.match(ports, /trait AudioLedgerPort/);
  assert.doesNotMatch(ports, /async fn try_submit|fn submit_blocking/);
});

test('SQLite ledger versions migrations and forbids unexplained sequence jumps', async () => {
  const [repository, migration] = await Promise.all([
    read('native/core/src/storage/repository.rs'),
    read('native/core/src/storage/migrations/0003_lifecycle.sql'),
  ]);

  assert.match(repository, /const SCHEMA_VERSION: u32 = 3/);
  assert.match(repository, /PRAGMA journal_mode=WAL/);
  assert.match(repository, /without an exact gap/);
  assert.match(repository, /unknown_gap_count/);
  assert.match(migration, /extent_known/);
  assert.match(migration, /LifecycleTransition/);
  assert.match(migration, /idx_audio_chunk_channel_sequence/);
});
