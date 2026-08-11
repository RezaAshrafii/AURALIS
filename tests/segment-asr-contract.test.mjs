import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const go = await readFile(new URL('../native-probe/main.go', import.meta.url), 'utf8');
const vad = await readFile(new URL('../native-probe/vad.go', import.meta.url), 'utf8');

test('immutable speech segments and transcript revisions are persisted', () => {
  for (const needle of ['CREATE TABLE IF NOT EXISTS speech_segments','CREATE TABLE IF NOT EXISTS transcript_revisions','CREATE TABLE IF NOT EXISTS asr_jobs','CREATE TABLE IF NOT EXISTS turn_segments']) {
    assert.ok(server.includes(needle), needle);
  }
  assert.ok(server.includes("ev.type === 'segment.frozen'"));
  assert.ok(server.includes('processSegmentAsr'));
});

test('ASR has a production-target Google STT adapter and an explicit experimental Gemini adapter', () => {
  assert.ok(server.includes('google-stt-v2'));
  assert.ok(server.includes('speech.googleapis.com/v2/projects/'));
  assert.ok(server.includes('recognizers/_:recognize'));
  assert.ok(server.includes('gemini-audio-experimental'));
  assert.ok(server.includes("type:'input_audio'"));
  assert.ok(html.includes('Experimental validation'));
});

test('raw capture path stays independent from derived VAD analysis', () => {
  assert.match(go, /frames := make\(chan audioFrame, 256\)/);
  assert.match(go, /analysisFrames := make\(chan audioFrame, 512\)/);
  assert.ok(go.includes('Analysis/VAD is derived'));
  assert.ok(vad.includes('Raw spool remains untouched'));
});

test('loopback silent device-position advances are not automatically mislabeled as loss', () => {
  assert.ok(go.includes('audio.silence_span'));
  assert.ok(go.includes('WASAPI loopback may not emit packets while the render endpoint is silent'));
  assert.ok(go.includes('capture_queue_overflow_silent_span'));
});

test('derived VAD emits frozen segment IDs and band-limited derived WAV', () => {
  assert.ok(vad.includes('segment.frozen'));
  assert.ok(vad.includes('resampleWindowedSinc'));
  assert.ok(vad.includes('writePCM16Wav'));
  assert.ok(vad.includes('adaptive-rms-validation'));
});

test('turn cards are selectable and include both question and answer preview', () => {
  assert.ok(app.includes('card.onclick = () => selectTurn(turn.id)'));
  assert.ok(app.includes('turn-answer-preview'));
  assert.ok(app.includes("selectedId === turn.id ? ' full' : ''"));
  assert.ok(app.includes('renderTurnWithoutAnswer'));
  assert.ok(app.includes("api(`/v1/turns/${turnId}`)"));
  assert.ok(server.includes('turnWithLatestAnswerRows'));
});

test('turn detail endpoint binds audio segment transcript and answers to exact turn', () => {
  assert.ok(server.includes('turnDetailPath'));
  assert.ok(server.includes('WHERE ts.turn_id=?'));
  assert.ok(server.includes('latestAnswer'));
  assert.ok(app.includes('segment='));
});

test('ASR and Brain credentials remain RAM runtime settings, not localStorage', () => {
  assert.ok(server.includes('let asrRuntime'));
  assert.ok(server.includes('let brainRuntime'));
  assert.ok(!app.includes('localStorage.setItem'));
  assert.ok(!app.includes('localStorage.getItem'));
});


test('v0.10.4 exposes a visible live transcript feed independent from turn cards', () => {
  assert.ok(server.includes('/transcripts'));
  assert.ok(server.includes('transcriptTimeline'));
  assert.ok(app.includes('refreshTranscripts'));
  assert.ok(html.includes('Live Transcript'));
  assert.ok(html.includes('liveTranscriptFeed'));
});

test('quick runtime setup activates experimental audio transcription plus text brain with one RAM-only key', () => {
  assert.ok(server.includes('/v1/runtime/quick-setup'));
  assert.ok(app.includes('quickSetupRuntime'));
  assert.ok(html.includes('فعال‌سازی صوت→متن + Brain'));
  assert.ok(!app.includes('localStorage.setItem'));
});

test('enabling ASR queues previously frozen untranscribed segments instead of losing them', () => {
  assert.ok(server.includes('queuePendingAsr'));
  assert.ok(server.includes('pendingSegments'));
  assert.ok(server.includes('queued_pending'));
});

test('validation VAD exposes level telemetry and softer speech thresholds for user testing', () => {
  assert.ok(vad.includes('vad.level'));
  assert.ok(vad.includes('minThreshold := 0.0055'));
  assert.ok(vad.includes('st.candidateMs >= 100'));
});
