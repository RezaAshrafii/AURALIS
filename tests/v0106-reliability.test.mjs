import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldAutoAnswerTurn, isRuntimeCapabilityQuestion } from '../core/turn-policy.mjs';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../apps/web/public/app-react.js', import.meta.url), 'utf8');
const kit = await readFile(new URL('../apps/web/public/ui-kit.js', import.meta.url), 'utf8');
const vadUrl = new URL('../native-probe/vad.go', import.meta.url);
const hasProbeSource = existsSync(fileURLToPath(vadUrl));
const vad = hasProbeSource ? await readFile(vadUrl, 'utf8') : '';
const schema = await readFile(new URL('../core/answer-schema.mjs', import.meta.url), 'utf8');

test('meeting/oral ownership policy adapts safely when system audio is disabled', () => {
  assert.equal(shouldAutoAnswerTurn({kind:'question',source_role:'system'}, 'oral_copilot', {loopbackEnabled:true}), true);
  assert.equal(shouldAutoAnswerTurn({kind:'question',source_role:'user'}, 'oral_copilot', {loopbackEnabled:true}), false);
  assert.equal(shouldAutoAnswerTurn({kind:'question',source_role:'user'}, 'oral_copilot', {loopbackEnabled:false}), true);
  assert.equal(shouldAutoAnswerTurn({kind:'request',source_role:'manual'}, 'oral_copilot', {loopbackEnabled:true}), true);
  assert.equal(shouldAutoAnswerTurn({kind:'question',source_role:'user'}, 'study'), true);
  assert.equal(shouldAutoAnswerTurn({kind:'statement',source_role:'system'}, 'meeting'), false);
  assert.ok(kit.includes("value:'oral_copilot'"));
  assert.ok(app.includes('modeMeta'));
});

test('runtime audio capability questions bypass source hallucination', () => {
  assert.equal(isRuntimeCapabilityQuestion('صدای منو داری؟'), true);
  assert.equal(isRuntimeCapabilityQuestion('میکروفون کار می کنه؟'), true);
  assert.equal(isRuntimeCapabilityQuestion('واریانس چیست؟'), false);
  assert.ok(server.includes('function runtimeCapabilityAnswer'));
  assert.ok(server.includes('runtime-capability'));
  assert.ok(schema.includes("'runtime'"));
});

test('ASR retry stays persisted with bounded attempts and backoff', () => {
  assert.ok(server.includes("status='RETRY_WAIT'"));
  assert.ok(server.includes('attempt < 3'));
  assert.ok(server.includes('retryDelaySeconds'));
  assert.ok(server.includes('available_at'));
});

test('segment audio can be retranscribed without duplicate turn', () => {
  assert.ok(server.includes('/retranscribe'));
  assert.ok(server.includes('force:true'));
  assert.ok(server.includes('turn.transcript_revised'));
  assert.ok(app.includes('بازرونویسی'));
});

test('max-duration segmentation preserves one second overlap', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.ok(vad.includes('reason == "max_duration"'));
  assert.ok(vad.includes('overlapFrames := int(st.rate)'));
  assert.ok(vad.includes('overlap_ms'));
});
