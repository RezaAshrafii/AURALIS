import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contracts=await readFile(new URL('../packages/contracts/src/index.ts',import.meta.url),'utf8');
const store=await readFile(new URL('../apps/web/src/runtime-store.ts',import.meta.url),'utf8');
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

test('shared contracts cover durable audio-to-answer entities',()=>{
  for(const name of ['SessionRecord','AudioChannelRecord','SpeechSegmentRecord','TranscriptRevisionRecord','TurnRecord','AnswerRecord','GapRecord','HealthSnapshot']) assert.ok(contracts.includes(`interface ${name}`));
});

test('typed runtime reducer binds final answers by immutable turn id',()=>{
  assert.ok(store.includes('const answers = new Map(state.answers)'));
  assert.ok(store.includes('answers.set(event.payload.turnId, event.payload)'));
  assert.ok(store.includes('return { ...state, answers }'));
  assert.ok(store.includes('const turns = new Map(state.turns)'));
  assert.ok(store.includes('turns.set(event.payload.id, event.payload)'));
});

test('verification and deterministic web build are first-class scripts',()=>{
  assert.equal(pkg.scripts.verify,'node scripts/verify.mjs');
  assert.equal(pkg.scripts['frontend:build'],'node scripts/build-web.mjs');
});
