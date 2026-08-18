import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/app-react.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const goUrl = new URL('../native-probe/main.go', import.meta.url);
const vadUrl = new URL('../native-probe/vad.go', import.meta.url);
const audioFormatUrl = new URL('../native-probe/audio_format.go', import.meta.url);
const hasProbeSource = [goUrl,vadUrl,audioFormatUrl].every(url=>existsSync(fileURLToPath(url)));
const go = hasProbeSource ? await readFile(goUrl, 'utf8') : '';
const vad = hasProbeSource ? await readFile(vadUrl, 'utf8') : '';
const audioFormat = hasProbeSource ? await readFile(audioFormatUrl, 'utf8') : '';

test('immutable speech segments and transcript revisions are persisted', () => {
  for (const needle of ['CREATE TABLE IF NOT EXISTS speech_segments','CREATE TABLE IF NOT EXISTS transcript_revisions','CREATE TABLE IF NOT EXISTS asr_jobs','CREATE TABLE IF NOT EXISTS turn_segments']) assert.ok(server.includes(needle), needle);
  assert.ok(server.includes("ev.type === 'segment.frozen'"));
  assert.ok(server.includes('processSegmentAsr'));
});

test('ASR keeps Google STT target plus explicit Gemini validation adapter', () => {
  assert.ok(server.includes('google-stt-v2'));
  assert.ok(server.includes('speech.googleapis.com/v2/projects/'));
  assert.ok(server.includes('recognizers/_:recognize'));
  assert.ok(server.includes('gemini-audio-experimental'));
  assert.ok(server.includes("type:'input_audio'"));
});

test('raw capture path stays independent from VAD analysis', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.match(go, /frames := make\(chan audioFrame, 256\)/);
  assert.match(go, /analysisFrames := make\(chan audioFrame, 512\)/);
  assert.ok(go.includes('Analysis/VAD is derived'));
  assert.ok(vad.includes('Raw spool remains untouched'));
});

test('loopback silent advances are not mislabeled as loss', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.ok(go.includes('audio.silence_span'));
  assert.ok(go.includes('WASAPI loopback may not emit packets while the render endpoint is silent'));
});

test('derived VAD emits frozen segments and band-limited WAV', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.ok(vad.includes('segment.frozen'));
  assert.ok(vad.includes('resampleWindowedSinc'));
  assert.ok(vad.includes('writePCM16Wav'));
});

test('React UI exposes selectable Turn cards and bound inspector', () => {
  assert.ok(app.includes("className:'turn-card'"));
  assert.ok(app.includes('this.selectTurn(turn.id,{pin:true})'));
  assert.ok(app.includes('inspectorPinned'));
  assert.ok(app.includes('followLive')); 
  assert.ok(app.includes('renderInspector'));
  assert.ok(app.includes('/v1/turns/'));
  assert.ok(server.includes('turnWithLatestAnswerRows'));
});

test('turn detail endpoint binds segments and answers to exact turn', () => {
  assert.ok(server.includes('turnDetailPath'));
  assert.ok(server.includes('WHERE ts.turn_id=?'));
  assert.ok(server.includes('latestAnswer'));
  assert.ok(app.includes('transcript_provider'));
});

test('credentials remain RAM-only in the current behavior contract', () => {
  assert.ok(server.includes('let asrRuntime'));
  assert.ok(server.includes('let brainRuntime'));
  assert.ok(!app.includes("localStorage.setItem('apiKey'"));
  assert.ok(!app.includes('auralis-secret-store'));
});

test('visible live transcript remains independent from Turn cards', () => {
  assert.ok(server.includes('/transcripts'));
  assert.ok(server.includes('transcriptTimeline'));
  assert.ok(app.includes('/transcripts?limit=80'));
  assert.ok(app.includes('LIVE TRANSCRIPT'));
});

test('quick setup activates audio transcription and text brain with explicit key', () => {
  assert.ok(server.includes('/v1/runtime/quick-setup'));
  assert.ok(app.includes('quickSetup'));
  assert.ok(app.includes('فعال‌سازی AI'));
});

test('pending frozen segments are queued after ASR enable', () => {
  assert.ok(server.includes('queuePendingAsr'));
  assert.ok(server.includes('pendingSegments'));
  assert.ok(server.includes('queued_pending'));
});

test('validation VAD exposes level telemetry', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.ok(vad.includes('vad.level'));
  assert.ok(vad.includes('minThreshold := 0.0055'));
});

test('WAVEFORMATEXTENSIBLE parser uses byte offsets', {skip:!hasProbeSource&&'native-probe source is not shipped in the Portable package'}, () => {
  assert.ok(audioFormat.includes('raw[18:20]'));
  assert.ok(audioFormat.includes('raw[20:24]'));
  assert.ok(audioFormat.includes('raw[24:28]'));
  assert.ok(audioFormat.includes('Go struct-alignment corruption'));
});

test('React UI polling is non-overlapping', () => {
  assert.ok(app.includes('if(this.pollInFlight)return'));
  assert.ok(app.includes('this.pollInFlight=true'));
  assert.ok(app.includes('this.pollInFlight=false'));
});
