import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app/app-react.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('main session workspace no longer renders pipeline/history rail or duplicated Q&A list', () => {
  const start=app.indexOf('renderSession(){');
  const end=app.indexOf('renderSources(){');
  const block=app.slice(start,end);
  assert.ok(block.includes('renderSessionSummaryStrip()'));
  assert.ok(block.includes('renderTranscript()'));
  assert.ok(block.includes('renderInspector()'));
  assert.ok(block.includes('openConversationHub'));
  assert.ok(!block.includes('renderSessionRail()'));
  assert.ok(!block.includes('renderTurns()'));
});

test('recent sessions and conversation history are accessible as overlays', () => {
  for(const required of ['renderSessionsDrawer','renderConversationHub','renderTranscriptArchive','جلسات اخیر','مکالمات این جلسه','متن کامل جلسه']){
    assert.ok(app.includes(required),required);
  }
  assert.ok(app.includes('openSessionsDrawer.bind(this)'));
  assert.ok(app.includes('chooseTurnFromHub'));
});

test('live transcript is transcription-only newest-first and has no horizontal carousel', () => {
  const start=app.indexOf('renderTranscript(){');
  const end=app.indexOf('renderTurns(){');
  const block=app.slice(start,end);
  assert.ok(block.includes('this.state.transcripts.filter'));
  assert.ok(block.includes('successful.slice(0,4)'));
  assert.ok(!block.includes("'خطا: '+text(item.asr_error)"));
  assert.ok(block.includes('جدیدترین'));
  assert.ok(!block.includes('turn-answer'));
  const patch=css.slice(css.indexOf('/* v0.10.12'));
  assert.ok(patch.includes('.live-transcript-feed'));
  assert.ok(patch.includes('overflow:hidden'));
  assert.ok(!patch.includes('overflow-x:auto'));
});

test('automatic answer generation remains server-owned and selection remains display-only', () => {
  assert.ok(server.includes('queueMicrotask(()=>persistAutoAnswer(turn)'));
  assert.ok(server.includes('brainRuntime.autoAnswer'));
  assert.ok(app.includes('chooseTurnFromHub'));
  assert.ok(app.includes('this.selectTurn(id,{pin:true})'));
  assert.ok(!app.includes('chooseTurnFromHub(id){\n      await this.ensureTurnAnswer'));
});

test('processing cycle remains available in System diagnostics', () => {
  assert.ok(app.includes("className:'pipeline-diagnostics-surface'"));
  assert.ok(app.includes("title:'چرخهٔ پردازش'"));
});
